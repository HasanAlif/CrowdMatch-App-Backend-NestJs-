import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ActivityLog, ActivityType } from './schemas/activity-log.schema';
import {
  boostMilestoneMessage,
  bonusMatchMessage,
  broadcastSentMessage,
  matchRemovedMessage,
  userBlockedMessage,
  userJoinedMessage,
} from './activity-log.messages';

export const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const RECENT_ACTIVITY_LIMIT = 50;

export interface RecentActivityRow {
  message: string;
  createdAt: Date;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    @InjectModel(ActivityLog.name)
    private readonly activityLogModel: Model<ActivityLog>,
  ) {}

  async record(
    type: ActivityType,
    message: string,
    subject?: Types.ObjectId | string | null,
  ): Promise<void> {
    await this.activityLogModel.create({
      type,
      message,
      ...(subject ? { subject: new Types.ObjectId(subject) } : {}),
    });
  }

  private emit(
    type: ActivityType,
    message: string,
    subject?: Types.ObjectId | string | null,
  ): void {
    const onFailure = (err: unknown) =>
      this.logger.error(
        `Activity log write failed (${type}): ${message}`,
        err instanceof Error ? err.stack : String(err),
      );

    try {
      void this.record(type, message, subject).catch(onFailure);
    } catch (err) {
      onFailure(err);
    }
  }

  recordUserJoined(
    fullName: string | null | undefined,
    userId: Types.ObjectId | string,
  ): void {
    this.emit(ActivityType.UserJoined, userJoinedMessage(fullName), userId);
  }

  recordBonusMatch(
    nameA: string | null | undefined,
    nameB: string | null | undefined,
  ): void {
    this.emit(ActivityType.MatchCreated, bonusMatchMessage(nameA, nameB));
  }

  recordBroadcastSent(recipients: number): void {
    this.emit(ActivityType.BroadcastSent, broadcastSentMessage(recipients));
  }

  recordBoostMilestone(
    fullName: string | null | undefined,
    userId: Types.ObjectId | string,
  ): void {
    this.emit(ActivityType.Milestone, boostMilestoneMessage(fullName), userId);
  }

  recordUserBlocked(
    fullName: string | null | undefined,
    userId: Types.ObjectId | string,
  ): void {
    this.emit(ActivityType.UserBlocked, userBlockedMessage(fullName), userId);
  }

  recordMatchRemoved(
    nameA: string | null | undefined,
    nameB: string | null | undefined,
  ): void {
    this.emit(ActivityType.MatchRemoved, matchRemovedMessage(nameA, nameB));
  }

  async getRecent(
    limit: number = RECENT_ACTIVITY_LIMIT,
    now: Date = new Date(),
  ): Promise<RecentActivityRow[]> {
    const since = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS);

    return this.activityLogModel
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({ message: 1, createdAt: 1, _id: 0 })
      .lean<RecentActivityRow[]>()
      .exec();
  }

  async purgeForUser(userId: Types.ObjectId | string): Promise<number> {
    const res = await this.activityLogModel
      .deleteMany({ subject: new Types.ObjectId(userId) })
      .exec();
    return res.deletedCount ?? 0;
  }
}
