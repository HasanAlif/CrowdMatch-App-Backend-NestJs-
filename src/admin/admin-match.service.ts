import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User } from 'src/user/schemas/user.schema';
import { Match } from 'src/matching/schemas/match.schema';
import { zonedDateKey } from 'src/common/dashboard-time';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { MatchRecordsQueryDto } from './dto/match-records-query.dto';

export type MatchFeedStatus = 'Active' | 'Removed';

export function feedVisibilityStatus(
  isExpired: boolean | null | undefined,
): MatchFeedStatus {
  return isExpired ? 'Removed' : 'Active';
}

export interface MatchCountsResult {
  totalMatches: number;
  activeMatches: number;
  removedMatches: number;
}

export interface MatchRecordRow {
  _id: Types.ObjectId;
  matchId: string;
  users: string | null;
  score: number;
  date: string | null;
  status: MatchFeedStatus;
}

export interface MatchRecordsResult {
  records: MatchRecordRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface MatchRemovalResult {
  _id: string;
  matchId: string;
  status: MatchFeedStatus;
  removedByAdmin: boolean;
  removedAt: Date | null;
  alreadyRemoved: boolean;
}

interface LeanMatchRecordRow {
  _id: Types.ObjectId;
  user1: Types.ObjectId;
  user2: Types.ObjectId;
  totalVoteCount?: number | null;
  isExpired?: boolean | null;
  createdAt?: Date | null;
}

interface LeanRemovalRow {
  _id: Types.ObjectId;
  user1: Types.ObjectId;
  user2: Types.ObjectId;
  isExpired?: boolean | null;
  removedByAdmin?: boolean | null;
  removedAt?: Date | null;
}

interface LeanFullNameRow {
  _id: Types.ObjectId;
  fullName?: string | null;
}

const MATCH_RECORD_PROJECTION = {
  _id: 1,
  user1: 1,
  user2: 1,
  totalVoteCount: 1,
  isExpired: 1,
  createdAt: 1,
} as const;

const REMOVAL_PROJECTION = {
  _id: 1,
  user1: 1,
  user2: 1,
  isExpired: 1,
  removedByAdmin: 1,
  removedAt: 1,
} as const;

export function matchDisplayId(id: Types.ObjectId | string): string {
  return `MCH-${id.toString().slice(0, 5)}`;
}

@Injectable()
export class AdminMatchService {
  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly activityLog: ActivityLogService,
  ) {}

  // GET /admin/match-count
  async getMatchCount(): Promise<MatchCountsResult> {
    try {
      const [total, active] = await Promise.all([
        this.matchModel.estimatedDocumentCount().exec(),
        this.matchModel.countDocuments({ isExpired: false }).exec(),
      ]);

      return {
        totalMatches: total,
        activeMatches: active,
        removedMatches: Math.max(0, total - active),
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load match counts');
    }
  }

  // GET /admin/match-records
  async getMatchRecords(
    query: MatchRecordsQueryDto,
  ): Promise<MatchRecordsResult> {
    try {
      const { page, limit } = query;

      const [total, matches] = await Promise.all([
        this.matchModel.estimatedDocumentCount().exec(),
        this.matchModel
          .find({})
          .select(MATCH_RECORD_PROJECTION)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanMatchRecordRow[]>()
          .exec(),
      ]);

      const pagination = {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
      };

      if (matches.length === 0) return { records: [], pagination };

      const nameById = await this.fullNamesFor(
        matches.flatMap((m) => [m.user1, m.user2]),
      );

      return {
        records: matches.map((match) => this.buildRecord(match, nameById)),
        pagination,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load match records');
    }
  }

  // DELETE /admin/matches/:matchId
  async removeMatch(matchId: string): Promise<MatchRemovalResult> {
    try {
      if (!Types.ObjectId.isValid(matchId)) {
        throw new NotFoundException('Match not found');
      }

      const existing = await this.matchModel
        .findById(matchId)
        .select(REMOVAL_PROJECTION)
        .lean<LeanRemovalRow | null>()
        .exec();

      if (!existing) {
        throw new NotFoundException('Match not found');
      }

      if (existing.removedByAdmin === true) {
        return {
          _id: existing._id.toString(),
          matchId: matchDisplayId(existing._id),
          status: feedVisibilityStatus(existing.isExpired),
          removedByAdmin: true,
          removedAt: existing.removedAt ?? null,
          alreadyRemoved: true,
        };
      }

      const updated = await this.matchModel
        .findOneAndUpdate(
          { _id: matchId },
          {
            $set: {
              isExpired: true,
              removedByAdmin: true,
              removedAt: new Date(),
            },
          },
          { returnDocument: 'after' },
        )
        .select(REMOVAL_PROJECTION)
        .lean<LeanRemovalRow | null>()
        .exec();

      if (!updated) {
        throw new NotFoundException('Match not found');
      }

      await this.logRemoval(updated.user1, updated.user2);

      return {
        _id: updated._id.toString(),
        matchId: matchDisplayId(updated._id),
        status: feedVisibilityStatus(updated.isExpired),
        removedByAdmin: true,
        removedAt: updated.removedAt ?? null,
        alreadyRemoved: false,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to remove match');
    }
  }

  private async fullNamesFor(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.map((id) => id.toString()))].map(
      (id) => new Types.ObjectId(id),
    );

    const users = await this.userModel
      .find({ _id: { $in: unique } })
      .select({ _id: 1, fullName: 1 })
      .lean<LeanFullNameRow[]>()
      .exec();

    return new Map(users.map((u) => [u._id.toString(), u.fullName ?? null]));
  }

  private buildRecord(
    match: LeanMatchRecordRow,
    nameById: Map<string, string | null>,
  ): MatchRecordRow {
    const first = nameById.get(match.user1.toString()) ?? null;
    const second = nameById.get(match.user2.toString()) ?? null;

    return {
      _id: match._id,
      matchId: matchDisplayId(match._id),
      users: first && second ? `${first} & ${second}` : null,
      score: match.totalVoteCount ?? 0,
      date: match.createdAt ? zonedDateKey(match.createdAt) : null,
      status: feedVisibilityStatus(match.isExpired),
    };
  }

  private async logRemoval(
    user1: Types.ObjectId,
    user2: Types.ObjectId,
  ): Promise<void> {
    try {
      const nameById = await this.fullNamesFor([user1, user2]);
      this.activityLog.recordMatchRemoved(
        nameById.get(user1.toString()),
        nameById.get(user2.toString()),
      );
    } catch {
      // A moderation-feed row must never fail the removal it describes.
    }
  }
}
