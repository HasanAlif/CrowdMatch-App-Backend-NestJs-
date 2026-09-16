import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';

import { User } from 'src/user/schemas/user.schema';
import { AccountStatus } from 'src/user/user.types';
import { Match } from 'src/matching/schemas/match.schema';
import { Vote } from 'src/matching/schemas/vote.schema';
import {
  ActivityLogService,
  RECENT_ACTIVITY_LIMIT,
} from 'src/activity-log/activity-log.service';
import { formatRelativeTime } from 'src/activity-log/activity-log.messages';
import {
  buildDailySeries,
  DailyBucketRow,
  DASHBOARD_TIMEZONE,
  zonedMonthRange,
} from 'src/common/dashboard-time';

export const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const NON_DELETED_STATUSES = [
  AccountStatus.Active,
  AccountStatus.Suspended,
  AccountStatus.Banned,
  AccountStatus.Blocked,
];

export interface StatMetric {
  count: number;
  growth: number;
}

export interface UserStatistics {
  totalUsers: StatMetric;
  activeUsers: StatMetric;
  totalVotes: StatMetric;
  totalMatches: StatMetric;
}

export interface RecentActivityItem {
  activity: string;
  time: string;
}

interface WindowCounts {
  current: number;
  prior: number;
}

export function growthPercent(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function readWindows(rows: { _id: string; count: number }[]): WindowCounts {
  let current = 0;
  let prior = 0;
  for (const row of rows) {
    if (row._id === 'current') current = row.count;
    else if (row._id === 'prior') prior = row.count;
  }
  return { current, prior };
}

function windowBucket(
  currentStart: Date,
): PipelineStage.Group['$group']['_id'] {
  return {
    $cond: [{ $gte: ['$createdAt', currentStart] }, 'current', 'prior'],
  };
}

export function buildDistinctVoterPipeline(
  priorStart: Date,
  currentStart: Date,
  now: Date,
): PipelineStage[] {
  return [
    { $match: { createdAt: { $gte: priorStart, $lt: now } } },
    {
      $group: {
        _id: { w: windowBucket(currentStart), voter: '$voter' },
      },
    },
    { $group: { _id: '$_id.w', count: { $sum: 1 } } },
  ];
}

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Vote.name) private readonly voteModel: Model<Vote>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    private readonly activityLog: ActivityLogService,
  ) {}

  // GET /admin/statistics
  async getUserStatistics(now: Date = new Date()): Promise<UserStatistics> {
    const currentStart = new Date(now.getTime() - WINDOW_MS);
    const priorStart = new Date(now.getTime() - 2 * WINDOW_MS);

    const flowGroup = (currentStartAt: Date): PipelineStage => ({
      $group: { _id: windowBucket(currentStartAt), count: { $sum: 1 } },
    });

    try {
      const [
        totalUsersCount,
        totalVotesCount,
        totalMatchesCount,
        userFlow,
        voterFlow,
        voteFlow,
        matchFlow,
      ] = await Promise.all([
        this.userModel
          .countDocuments({ accountStatus: { $in: NON_DELETED_STATUSES } })
          .exec(),

        this.voteModel.estimatedDocumentCount().exec(),
        this.matchModel.estimatedDocumentCount().exec(),

        this.userModel
          .aggregate<{ _id: string; count: number }>([
            {
              $match: {
                createdAt: { $gte: priorStart, $lt: now },
                accountStatus: { $in: NON_DELETED_STATUSES },
              },
            },
            flowGroup(currentStart),
          ])
          .exec(),

        this.voteModel
          .aggregate<{ _id: string; count: number }>(
            buildDistinctVoterPipeline(priorStart, currentStart, now),
          )
          .exec(),

        this.voteModel
          .aggregate<{ _id: string; count: number }>([
            { $match: { createdAt: { $gte: priorStart, $lt: now } } },
            flowGroup(currentStart),
          ])
          .exec(),

        this.matchModel
          .aggregate<{ _id: string; count: number }>([
            { $match: { createdAt: { $gte: priorStart, $lt: now } } },
            flowGroup(currentStart),
          ])
          .exec(),
      ]);

      const users = readWindows(userFlow);
      const voters = readWindows(voterFlow);
      const votes = readWindows(voteFlow);
      const matches = readWindows(matchFlow);

      return {
        totalUsers: {
          count: totalUsersCount,
          growth: growthPercent(users.current, users.prior),
        },
        activeUsers: {
          count: voters.current,
          growth: growthPercent(voters.current, voters.prior),
        },
        totalVotes: {
          count: totalVotesCount,
          growth: growthPercent(votes.current, votes.prior),
        },
        totalMatches: {
          count: totalMatchesCount,
          growth: growthPercent(matches.current, matches.prior),
        },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load user statistics');
    }
  }

  // GET /admin/user-growth
  async getDailyUserGrowth(
    monthIndex: number,
    year: number,
  ): Promise<Record<string, number>> {
    return this.dailySeries(this.userModel, monthIndex, year, {
      accountStatus: { $in: NON_DELETED_STATUSES },
    });
  }

  // GET /admin/match-trend
  async getMatchCreationTrend(
    monthIndex: number,
    year: number,
  ): Promise<Record<string, number>> {
    return this.dailySeries(this.matchModel, monthIndex, year);
  }

  private async dailySeries(
    model: Model<any>,
    monthIndex: number,
    year: number,
    extraMatch: Record<string, unknown> = {},
  ): Promise<Record<string, number>> {
    const { start, end } = zonedMonthRange(monthIndex, year);

    try {
      const rows = await model
        .aggregate<DailyBucketRow>([
          { $match: { createdAt: { $gte: start, $lt: end }, ...extraMatch } },
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
        ])
        .exec();

      return buildDailySeries(rows, monthIndex, year);
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException('Failed to load daily series');
    }
  }

  // GET /admin/recent-activity
  async getRecentActivity(
    limit: number = RECENT_ACTIVITY_LIMIT,
    now: Date = new Date(),
  ): Promise<RecentActivityItem[]> {
    const rows = await this.activityLog.getRecent(limit, now);

    return rows.map((row) => ({
      activity: row.message,
      time: formatRelativeTime(new Date(row.createdAt), now),
    }));
  }
}
