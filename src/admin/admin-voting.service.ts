import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';

import { User } from 'src/user/schemas/user.schema';
import { Match } from 'src/matching/schemas/match.schema';
import { Vote, VoteType } from 'src/matching/schemas/vote.schema';
import {
  buildWeekdaySeries,
  DailyBucketRow,
  DASHBOARD_TIMEZONE,
  zonedDayWindow,
} from 'src/common/dashboard-time';
import { VoteRecordsQueryDto } from './dto/vote-records-query.dto';

/**
 * Seven days of trend, and seven is a ceiling rather than a default: the series
 * is keyed by weekday NAME, so at 8+ days two entries collide on the same key.
 */
export const TREND_DAYS = 7;

export interface VoteCountsResult {
  totalVotes: number;
  positiveVotes: number;
  negativeVotes: number;
}

export interface VoteDistributionResult {
  positive: number;
  negative: number;
  positiveRate: number;
  negativeRate: number;
}

export type DailyVotingTrend = Record<string, number>;

export interface VoteRecordRow {
  voteId: string;
  voter: string | null;
  target: string | null;
  voteType: VoteType;
  dateTime: Date | null;
  accuracy: number;
}

export interface VoteRecordsResult {
  records: VoteRecordRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface LeanVoteRow {
  _id: Types.ObjectId;
  voter: Types.ObjectId;
  match: Types.ObjectId;
  voteType: VoteType;
  createdAt?: Date | null;
}

interface LeanMatchRow {
  _id: Types.ObjectId;
  user1: Types.ObjectId;
  user2: Types.ObjectId;
  totalVoteCount?: number | null;
  positiveVoteCount?: number | null;
  negativeVoteCount?: number | null;
}

interface LeanDisplayIdRow {
  _id: Types.ObjectId;
  displayId?: string | null;
}

const VOTE_ROW_PROJECTION = {
  _id: 1,
  voter: 1,
  match: 1,
  voteType: 1,
  createdAt: 1,
} as const;

const MATCH_ROW_PROJECTION = {
  _id: 1,
  user1: 1,
  user2: 1,
  totalVoteCount: 1,
  positiveVoteCount: 1,
  negativeVoteCount: 1,
} as const;

export function buildDailyTrendPipeline(
  start: Date,
  end: Date,
): PipelineStage[] {
  return [
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: DASHBOARD_TIMEZONE,
          },
        },
        count: { $sum: 1 },
      },
    },
  ];
}

export function splitRates(
  positive: number,
  negative: number,
): { positiveRate: number; negativeRate: number } {
  const total = positive + negative;
  if (total === 0) return { positiveRate: 0, negativeRate: 0 };

  const positiveRate = Math.round((positive / total) * 1000) / 10;
  return {
    positiveRate,
    negativeRate: Math.round((100 - positiveRate) * 10) / 10,
  };
}

export function voteAccuracy(
  voteType: VoteType,
  match: LeanMatchRow | undefined,
): number {
  const total = match?.totalVoteCount ?? 0;
  if (total <= 0) return 0;

  const agreeing =
    voteType === VoteType.Positive
      ? (match?.positiveVoteCount ?? 0)
      : (match?.negativeVoteCount ?? 0);

  return Math.round((agreeing / total) * 100);
}

@Injectable()
export class AdminVotingService {
  constructor(
    @InjectModel(Vote.name) private readonly voteModel: Model<Vote>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  // GET /admin/vote-count
  async getVoteCount(): Promise<VoteCountsResult> {
    try {
      const { positive, negative } = await this.countsByType();

      return {
        totalVotes: positive + negative,
        positiveVotes: positive,
        negativeVotes: negative,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load vote counts');
    }
  }

  // GET /admin/vote-distribution
  async voteDistribution(): Promise<VoteDistributionResult> {
    try {
      const { positive, negative } = await this.countsByType();

      return { positive, negative, ...splitRates(positive, negative) };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        'Failed to load vote distribution',
      );
    }
  }

  // GET /admin/voting-trend
  async getDailyVotingTrend(now: Date = new Date()): Promise<DailyVotingTrend> {
    try {
      const { start, end, dayKeys } = zonedDayWindow(now, TREND_DAYS);

      const rows = await this.voteModel
        .aggregate<DailyBucketRow>(buildDailyTrendPipeline(start, end))
        .exec();

      return buildWeekdaySeries(rows, dayKeys);
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load voting trend');
    }
  }

  // GET /admin/vote-records
  async getVoteRecords(query: VoteRecordsQueryDto): Promise<VoteRecordsResult> {
    try {
      const { page, limit } = query;

      const [total, votes] = await Promise.all([
        this.voteModel.estimatedDocumentCount().exec(),
        this.voteModel
          .find({})
          .select(VOTE_ROW_PROJECTION)
          .sort({ createdAt: -1, voter: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanVoteRow[]>()
          .exec(),
      ]);

      const pagination = {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 0,
      };

      if (votes.length === 0) return { records: [], pagination };

      const { matchById, displayIdById } = await this.enrich(votes);

      return {
        records: votes.map((vote) =>
          this.buildRecord(vote, matchById, displayIdById),
        ),
        pagination,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load vote records');
    }
  }

  private async countsByType(): Promise<{
    positive: number;
    negative: number;
  }> {
    const [positive, negative] = await Promise.all([
      this.voteModel.countDocuments({ voteType: VoteType.Positive }).exec(),
      this.voteModel.countDocuments({ voteType: VoteType.Negative }).exec(),
    ]);

    return { positive, negative };
  }

  private async enrich(votes: LeanVoteRow[]): Promise<{
    matchById: Map<string, LeanMatchRow>;
    displayIdById: Map<string, string | null>;
  }> {
    const matchIds = [...new Set(votes.map((v) => v.match.toString()))].map(
      (id) => new Types.ObjectId(id),
    );

    const matches = await this.matchModel
      .find({ _id: { $in: matchIds } })
      .select(MATCH_ROW_PROJECTION)
      .lean<LeanMatchRow[]>()
      .exec();

    const matchById = new Map(matches.map((m) => [m._id.toString(), m]));

    const userIds = new Set<string>(votes.map((v) => v.voter.toString()));
    for (const match of matches) {
      userIds.add(match.user1.toString());
      userIds.add(match.user2.toString());
    }

    const users = await this.userModel
      .find({
        _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) },
      })
      .select({ _id: 1, displayId: 1 })
      .lean<LeanDisplayIdRow[]>()
      .exec();

    return {
      matchById,
      displayIdById: new Map(
        users.map((u) => [u._id.toString(), u.displayId ?? null]),
      ),
    };
  }

  private buildRecord(
    vote: LeanVoteRow,
    matchById: Map<string, LeanMatchRow>,
    displayIdById: Map<string, string | null>,
  ): VoteRecordRow {
    const match = matchById.get(vote.match.toString());

    const first = match
      ? (displayIdById.get(match.user1.toString()) ?? null)
      : null;
    const second = match
      ? (displayIdById.get(match.user2.toString()) ?? null)
      : null;

    return {
      voteId: `VT-${vote._id.toString().slice(0, 5)}`,
      voter: displayIdById.get(vote.voter.toString()) ?? null,
      target: first && second ? `${first} & ${second}` : null,
      voteType: vote.voteType,
      dateTime: vote.createdAt ?? null,
      accuracy: voteAccuracy(vote.voteType, match),
    };
  }
}
