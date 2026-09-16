import {
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User } from 'src/user/schemas/user.schema';
import { UserService } from 'src/user/user.service';
import { AccountStatus, Role } from 'src/user/user.types';
import { Match } from 'src/matching/schemas/match.schema';
import { Vote, VoteType } from 'src/matching/schemas/vote.schema';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { escapeRegex } from 'src/common/regex';
import { zonedDateKey } from 'src/common/dashboard-time';
import { NON_DELETED_STATUSES } from './admin-dashboard.service';
import {
  ListUsersQueryDto,
  SearchUsersQueryDto,
  UserStatusFilter,
} from './dto/list-users-query.dto';
import { UserStatusAction } from './dto/update-user-status.dto';

export const SEARCH_CANDIDATE_CAP = 500;

export interface AdminUserRow {
  _id: string;
  userId: string | null;
  name: string | null;
  phoneNumber: string | null;
  joinDate: string | null;
  votes: number;
  withCrowdPercentage: number;
  matches: number;
  status: AccountStatus;
}

export interface AdminUserListResult {
  totalRegistered: number;
  totalActive: number;
  users: AdminUserRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface UserStatusChangeResult {
  _id: string;
  userId: string | null;
  name: string | null;
  status: AccountStatus;
  isActive: boolean;
}

interface LeanUserRow {
  _id: Types.ObjectId;
  displayId?: string | null;
  fullName?: string | null;
  phoneNumber?: string | null;
  createdAt?: Date | null;
  totalVotes?: number | null;
  accountStatus: AccountStatus;
}

interface LeanStatusRow {
  _id: Types.ObjectId;
  fullName?: string | null;
  displayId?: string | null;
  role?: Role;
  accountStatus: AccountStatus;
  isActive: boolean;
}

interface RowStats {
  positiveVotes: number;
  totalVotes: number;
  matches: number;
}

const ROW_PROJECTION = {
  _id: 1,
  displayId: 1,
  fullName: 1,
  phoneNumber: 1,
  createdAt: 1,
  totalVotes: 1,
  accountStatus: 1,
} as const;

@Injectable()
export class AdminUserService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Vote.name) private readonly voteModel: Model<Vote>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    private readonly userService: UserService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // Listing Users
  // GET /admin/users
  async listUsers(query: ListUsersQueryDto): Promise<AdminUserListResult> {
    try {
      const { page, limit } = query;
      const filter = this.statusFilter(query.status);

      const [total, users] = await Promise.all([
        this.userModel.countDocuments(filter).exec(),
        this.userModel
          .find(filter)
          .select(ROW_PROJECTION)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanUserRow[]>()
          .exec(),
      ]);

      return await this.assemble(users, total, page, limit);
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to retrieve users',
      );
    }
  }

  async searchUsers(query: SearchUsersQueryDto): Promise<AdminUserListResult> {
    try {
      const { page, limit } = query;
      const statusFilter = this.statusFilter(query.status);

      const term = query.searchTerm.trim();
      const safe = escapeRegex(term);
      const contains = new RegExp(safe, 'i');
      const startsWith = new RegExp(`^${safe}`, 'i');

      const [exact, candidates] = await Promise.all([
        this.userModel
          .findOne({ ...statusFilter, displayId: term.toUpperCase() })
          .select(ROW_PROJECTION)
          .lean<LeanUserRow | null>()
          .exec(),
        this.userModel
          .find({ ...statusFilter, fullName: contains })
          .select(ROW_PROJECTION)
          .limit(SEARCH_CANDIDATE_CAP)
          .lean<LeanUserRow[]>()
          .exec(),
      ]);

      const byName = (a: LeanUserRow, b: LeanUserRow) =>
        (a.fullName ?? '').localeCompare(b.fullName ?? '');

      const prefixTier = candidates
        .filter((u) => startsWith.test(u.fullName ?? ''))
        .sort(byName);
      const containsTier = candidates
        .filter((u) => !startsWith.test(u.fullName ?? ''))
        .sort(byName);

      const seen = new Set<string>();
      const ranked = [
        ...(exact ? [exact] : []),
        ...prefixTier,
        ...containsTier,
      ].filter((u) => {
        const key = u._id.toString();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const start = (page - 1) * limit;
      const pageRows = ranked.slice(start, start + limit);

      return await this.assemble(pageRows, ranked.length, page, limit);
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to search users',
      );
    }
  }

  // Block / unblock
  // PATCH /admin/users/:userId
  async setUserStatus(
    userId: string,
    action: UserStatusAction,
  ): Promise<UserStatusChangeResult> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new NotFoundException('User not found');
      }

      const target =
        action === 'block' ? AccountStatus.Blocked : AccountStatus.Active;

      const existing = await this.userModel
        .findById(userId)
        .select('fullName displayId role accountStatus isActive')
        .lean<LeanStatusRow | null>()
        .exec();

      if (!existing) {
        throw new NotFoundException('User not found');
      }

      if (existing.accountStatus === AccountStatus.Deleted) {
        throw new GoneException('This account has already been deleted');
      }

      if (existing.role === Role.Admin) {
        throw new ForbiddenException('Admin accounts cannot be blocked');
      }

      if (existing.accountStatus === target) {
        return this.statusResult(existing);
      }

      const updated = await this.userModel
        .findOneAndUpdate(
          { _id: userId },
          { $set: { accountStatus: target } },
          { returnDocument: 'after' },
        )
        .select('fullName displayId accountStatus isActive')
        .lean<LeanStatusRow | null>()
        .exec();

      if (!updated) {
        throw new NotFoundException('User not found');
      }

      if (action === 'block') {
        await this.userService.expireActiveMatches(userId);
        try {
          this.activityLog.recordUserBlocked(updated.fullName, userId);
        } catch {
          // already logged inside the activity-log service
        }
      }

      return this.statusResult(updated);
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to update user status',
      );
    }
  }

  // Shared internals
  private statusFilter(status: UserStatusFilter): Record<string, unknown> {
    switch (status) {
      case 'active':
        return { accountStatus: AccountStatus.Active };
      case 'blocked':
        return { accountStatus: AccountStatus.Blocked };
      case 'all':
      default:
        return { accountStatus: { $in: NON_DELETED_STATUSES } };
    }
  }

  private async assemble(
    users: LeanUserRow[],
    total: number,
    page: number,
    limit: number,
  ): Promise<AdminUserListResult> {
    const ids = users.map((u) => u._id);

    const [stats, totalRegistered, totalActive] = await Promise.all([
      this.fetchRowStats(ids),
      this.userModel
        .countDocuments({ accountStatus: { $in: NON_DELETED_STATUSES } })
        .exec(),
      this.userModel
        .countDocuments({ accountStatus: AccountStatus.Active })
        .exec(),
    ]);

    return {
      totalRegistered,
      totalActive,
      users: users.map((u) => this.buildRow(u, stats.get(u._id.toString()))),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async fetchRowStats(
    ids: Types.ObjectId[],
  ): Promise<Map<string, RowStats>> {
    const stats = new Map<string, RowStats>();
    if (ids.length === 0) return stats;

    const ensure = (key: string): RowStats => {
      let row = stats.get(key);
      if (!row) {
        row = { positiveVotes: 0, totalVotes: 0, matches: 0 };
        stats.set(key, row);
      }
      return row;
    };

    const [voteRows, matchRows] = await Promise.all([
      this.voteModel
        .aggregate<{ _id: Types.ObjectId; total: number; positive: number }>([
          { $match: { voter: { $in: ids } } },
          {
            $group: {
              _id: '$voter',
              total: { $sum: 1 },
              positive: {
                $sum: {
                  $cond: [{ $eq: ['$voteType', VoteType.Positive] }, 1, 0],
                },
              },
            },
          },
        ])
        .exec(),

      this.matchModel
        .aggregate<{ _id: Types.ObjectId; matches: number }>([
          {
            $match: {
              $or: [{ user1: { $in: ids } }, { user2: { $in: ids } }],
            },
          },
          { $project: { pair: ['$user1', '$user2'] } },
          { $unwind: '$pair' },
          { $match: { pair: { $in: ids } } },
          { $group: { _id: '$pair', matches: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    for (const row of voteRows) {
      const entry = ensure(row._id.toString());
      entry.totalVotes = row.total;
      entry.positiveVotes = row.positive;
    }

    for (const row of matchRows) {
      ensure(row._id.toString()).matches = row.matches;
    }

    return stats;
  }

  private buildRow(user: LeanUserRow, stats?: RowStats): AdminUserRow {
    const votesCast = stats?.totalVotes ?? 0;

    return {
      _id: user._id.toString(),
      userId: user.displayId ?? null,
      name: user.fullName ?? null,
      phoneNumber: user.phoneNumber ?? null,
      joinDate: user.createdAt ? zonedDateKey(user.createdAt) : null,
      votes: user.totalVotes ?? 0,
      withCrowdPercentage:
        votesCast > 0
          ? Math.round(((stats?.positiveVotes ?? 0) / votesCast) * 100)
          : 0,
      matches: stats?.matches ?? 0,
      status: user.accountStatus,
    };
  }

  private statusResult(user: LeanStatusRow): UserStatusChangeResult {
    return {
      _id: user._id.toString(),
      userId: user.displayId ?? null,
      name: user.fullName ?? null,
      status: user.accountStatus,
      isActive: user.isActive,
    };
  }
}
