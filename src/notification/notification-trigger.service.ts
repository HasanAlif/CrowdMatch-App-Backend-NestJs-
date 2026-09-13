import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User } from '../user/schemas/user.schema';
import { AccountStatus } from '../user/user.types';
import { Match } from '../matching/schemas/match.schema';
import { Vote } from '../matching/schemas/vote.schema';
import { NotificationType } from './schemas/notification.schema';
import {
  BROADCAST_PAGE_SIZE,
  NotificationContent,
  NotificationService,
} from './notification.service';
import {
  BOOST_ENDED_COPY,
  DAILY_REMINDER_FALLBACK_BODY,
  DAILY_REMINDER_TITLE,
  MILESTONE_COPY,
  PartnerRef,
  PartnerSource,
  dailySentimentLine,
  dailyVotesLine,
  matchAcceptedCopy,
  newMatchCopy,
  partnerName,
  partnerPicture,
  resolveMilestone,
} from './notification-copy';

export interface DailyReminderStats {
  candidates: number;
  notified: number;
  recordsCreated: number;
  pushed: number;
  elapsedMs: number;
}

export interface BroadcastStats {
  usersProcessed: number;
  recordsCreated: number;
  pushed: number;
  elapsedMs: number;
}

export interface BoostSweepStats {
  claimed: number;
  recordsCreated: number;
  pushed: number;
  elapsedMs: number;
}

export interface NewMatchRecord {
  matchId: Types.ObjectId;
  user1: Types.ObjectId;
  user2: Types.ObjectId;
}

export type PartnerMap = Map<string, PartnerSource>;

export const BOOST_SWEEP_PAGE_SIZE = 1000;

const PARTNER_FIELDS = { fullName: 1, picture: 1, 'photos.url': 1 };

@Injectable()
export class NotificationTriggerService {
  private readonly logger = new Logger(NotificationTriggerService.name);

  constructor(
    private readonly notifications: NotificationService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Vote.name) private readonly voteModel: Model<Vote>,
  ) {}

  private async resolvePartners(
    ids: Types.ObjectId[],
    supplied?: PartnerMap,
  ): Promise<PartnerMap> {
    const map: PartnerMap = new Map(supplied ?? []);

    const missing = ids.filter((id) => !map.has(id.toString()));
    if (missing.length === 0) return map;

    const rows = await this.userModel
      .find({ _id: { $in: missing } })
      .select(PARTNER_FIELDS)
      .lean<(PartnerSource & { _id: Types.ObjectId })[]>()
      .exec();

    for (const row of rows) map.set(row._id.toString(), row);

    return map;
  }

  private toPartnerRef(
    matchId: Types.ObjectId,
    partnerId: Types.ObjectId,
    partners: PartnerMap,
  ): PartnerRef {
    const source = partners.get(partnerId.toString());
    return {
      matchId: matchId.toString(),
      userId: partnerId.toString(),
      fullName: partnerName(source),
      picture: partnerPicture(source),
    };
  }

  async notifyNewMatches(
    matches: NewMatchRecord[],
    suppliedPartners?: PartnerMap,
  ): Promise<void> {
    if (matches.length === 0) return;

    // Every id that appears as somebody's partner.
    const everyone = new Set<string>();
    for (const m of matches) {
      everyone.add(m.user1.toString());
      everyone.add(m.user2.toString());
    }

    const partners = await this.resolvePartners(
      [...everyone].map((id) => new Types.ObjectId(id)),
      suppliedPartners,
    );

    // recipient -> the partners THEY were matched with.
    const byRecipient = new Map<string, PartnerRef[]>();
    const add = (
      recipient: Types.ObjectId,
      partner: Types.ObjectId,
      matchId: Types.ObjectId,
    ) => {
      const key = recipient.toString();
      const list = byRecipient.get(key) ?? [];
      list.push(this.toPartnerRef(matchId, partner, partners));
      byRecipient.set(key, list);
    };

    for (const m of matches) {
      add(m.user1, m.user2, m.matchId);
      add(m.user2, m.user1, m.matchId);
    }

    const recipients = [...byRecipient.keys()].map(
      (id) => new Types.ObjectId(id),
    );

    const contentFor = (recipient: Types.ObjectId): NotificationContent => {
      const list = byRecipient.get(recipient.toString()) ?? [];
      const count = list.length;
      return {
        type: NotificationType.NewMatch,
        ...newMatchCopy(count),
        data: { count, partners: list },
        pushData: { count },
      };
    };

    const res = await this.notifications.createAndPush(
      recipients,
      contentFor,
      'isNotifyNewMatches',
    );

    this.logger.log(
      `New-match notifications: ${res.recordsCreated} record(s) for ` +
        `${recipients.length} user(s), ${res.pushed} push(es)`,
    );
  }

  async notifyMatchAccepted(
    matchId: Types.ObjectId,
    accepterId: Types.ObjectId,
    otherParticipantId: Types.ObjectId,
  ): Promise<void> {
    const accepter = await this.userModel
      .findById(accepterId)
      .select(PARTNER_FIELDS)
      .lean<PartnerSource | null>()
      .exec();

    const partner: PartnerRef = {
      matchId: matchId.toString(),
      userId: accepterId.toString(),
      fullName: partnerName(accepter),
      picture: partnerPicture(accepter),
    };

    const res = await this.notifications.createAndPush(
      [otherParticipantId],
      () => ({
        type: NotificationType.MatchAccepted,
        ...matchAcceptedCopy(partner.fullName),
        data: { ...partner },
      }),
      'isNotifyNewMatches',
    );

    this.logger.log(
      `Match-accepted notification for ${otherParticipantId.toString()}: ` +
        `${res.recordsCreated} record(s), ${res.pushed} push(es)`,
    );
  }

  async notifyVoteMilestone(
    userId: Types.ObjectId,
    newTotal: number,
    newCurrent: number,
  ): Promise<void> {
    const milestone = resolveMilestone(newTotal, newCurrent);
    if (!milestone) return;

    const res = await this.notifications.createAndPush(
      [userId],
      () => ({
        type: NotificationType.VoteMilestone,
        ...MILESTONE_COPY[milestone.key],
        data: { milestone: milestone.key, threshold: milestone.threshold },
      }),
      'isNotifyActivityReminders',
    );

    this.logger.log(
      `Vote milestone '${milestone.key}' (${milestone.threshold}) for ` +
        `${userId.toString()}: ${res.recordsCreated} record(s), ` +
        `${res.pushed} push(es)`,
    );
  }

  async sweepEndedBoosts(now = new Date()): Promise<BoostSweepStats> {
    const startedAt = Date.now();
    let claimedTotal = 0;
    let recordsCreated = 0;
    let pushed = 0;

    for (;;) {
      const due = await this.userModel
        .find({ boostEndsNotifyAt: { $lte: now } })
        .select({ _id: 1 })
        .limit(BOOST_SWEEP_PAGE_SIZE)
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      if (due.length === 0) break;

      const ids = due.map((u) => u._id);

      const claim = await this.userModel
        .updateMany(
          { _id: { $in: ids }, boostEndsNotifyAt: { $lte: now } },
          {
            $unset: { boostEndsNotifyAt: '' },
            $set: { boostEndNotifiedAt: now },
          },
        )
        .exec();

      let claimedIds = ids;

      if (claim.modifiedCount !== ids.length) {
        const stillPending = await this.userModel
          .find({ _id: { $in: ids }, boostEndsNotifyAt: { $exists: true } })
          .select({ _id: 1 })
          .lean<{ _id: Types.ObjectId }[]>()
          .exec();

        const skip = new Set(stillPending.map((u) => u._id.toString()));
        claimedIds = ids.filter((id) => !skip.has(id.toString()));

        this.logger.warn(
          `Boost sweep: ${skip.size} user(s) re-earned a boost mid-sweep — ` +
            `their announcement is deferred to the new expiry`,
        );
      }

      if (claimedIds.length > 0) {
        try {
          const res = await this.notifications.createAndPush(
            claimedIds,
            () => ({
              type: NotificationType.BoostEnded,
              ...BOOST_ENDED_COPY,
            }),
            'isNotifyActivityReminders',
          );
          recordsCreated += res.recordsCreated;
          pushed += res.pushed;
        } catch (err) {
          this.logger.error(
            `Boost-end notification page failed: ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
        claimedTotal += claimedIds.length;
      }

      if (due.length < BOOST_SWEEP_PAGE_SIZE) break;
    }

    const elapsedMs = Date.now() - startedAt;

    if (claimedTotal > 0) {
      this.logger.log(
        `Boost sweep: ${claimedTotal} boost(s) ended, ${recordsCreated} ` +
          `record(s), ${pushed} push(es), ${elapsedMs}ms`,
      );
    }

    return { claimed: claimedTotal, recordsCreated, pushed, elapsedMs };
  }

  async sendDailyActivityReminder(
    now = new Date(),
  ): Promise<DailyReminderStats> {
    const startedAt = Date.now();

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOid = Types.ObjectId.createFromTime(
      Math.floor(startOfDay.getTime() / 1000),
    );

    const voteRows = await this.voteModel
      .aggregate<{ _id: Types.ObjectId; votesToday: number }>([
        { $match: { _id: { $gte: startOid } } },
        { $group: { _id: '$voter', votesToday: { $sum: 1 } } },
      ])
      .exec();

    const sentimentRows = await this.matchModel
      .aggregate<{
        _id: Types.ObjectId;
        positive: number;
        negative: number;
        total: number;
      }>([
        { $match: { isExpired: false, totalVoteCount: { $gt: 0 } } },
        {
          $project: {
            participants: ['$user1', '$user2'],
            positiveVoteCount: 1,
            negativeVoteCount: 1,
            totalVoteCount: 1,
          },
        },
        { $unwind: '$participants' },
        {
          $group: {
            _id: '$participants',
            positive: { $sum: '$positiveVoteCount' },
            negative: { $sum: '$negativeVoteCount' },
            total: { $sum: '$totalVoteCount' },
          },
        },
      ])
      .exec();

    const votesByUser = new Map<string, number>();
    for (const r of voteRows) votesByUser.set(r._id.toString(), r.votesToday);

    const sentimentByUser = new Map<
      string,
      { positive: number; negative: number; total: number }
    >();
    for (const r of sentimentRows) {
      sentimentByUser.set(r._id.toString(), {
        positive: r.positive,
        negative: r.negative,
        total: r.total,
      });
    }

    const candidateIds = new Set<string>([
      ...votesByUser.keys(),
      ...sentimentByUser.keys(),
    ]);

    const bodies = new Map<string, string>();
    for (const id of candidateIds) {
      const votes = votesByUser.get(id) ?? 0;
      const s = sentimentByUser.get(id);

      const parts: string[] = [];
      if (votes > 0) parts.push(dailyVotesLine(votes));
      if (s && s.total > 0) {
        parts.push(
          dailySentimentLine(Math.round((s.positive / s.total) * 100)),
        );
      }

      if (parts.length > 0) bodies.set(id, parts.join(' '));
    }

    if (bodies.size === 0) {
      const elapsedMs = Date.now() - startedAt;
      this.logger.log(
        `Daily reminder: nothing to report (${elapsedMs}ms, ` +
          `${voteRows.length} voter row(s), ${sentimentRows.length} sentiment row(s))`,
      );
      return {
        candidates: 0,
        notified: 0,
        recordsCreated: 0,
        pushed: 0,
        elapsedMs,
      };
    }

    const candidateRecipients = [...bodies.keys()].map(
      (id) => new Types.ObjectId(id),
    );

    const recipients = await this.activeRecipients(candidateRecipients);

    if (recipients.length === 0) {
      const elapsedMs = Date.now() - startedAt;
      this.logger.log(
        `Daily reminder: no active recipients after status filter ` +
          `(${candidateRecipients.length} candidate(s)), ${elapsedMs}ms`,
      );
      return {
        candidates: candidateIds.size,
        notified: 0,
        recordsCreated: 0,
        pushed: 0,
        elapsedMs,
      };
    }

    const res = await this.notifications.createAndPush(
      recipients,
      (recipient) => ({
        type: NotificationType.ActivityReminder,
        title: DAILY_REMINDER_TITLE,
        body: bodies.get(recipient.toString()) ?? DAILY_REMINDER_FALLBACK_BODY,
      }),
      'isNotifyActivityReminders',
    );

    const elapsedMs = Date.now() - startedAt;

    this.logger.log(
      `Daily reminder: ${res.recordsCreated} record(s) for ` +
        `${recipients.length} user(s), ${res.pushed} push(es), ${elapsedMs}ms`,
    );

    return {
      candidates: candidateIds.size,
      notified: recipients.length,
      recordsCreated: res.recordsCreated,
      pushed: res.pushed,
      elapsedMs,
    };
  }

  private async activeRecipients(
    candidates: Types.ObjectId[],
  ): Promise<Types.ObjectId[]> {
    if (candidates.length === 0) return [];

    const rows = await this.userModel
      .find({ _id: { $in: candidates }, accountStatus: AccountStatus.Active })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();

    return rows.map((r) => r._id);
  }

  async broadcast(title: string, message: string): Promise<BroadcastStats> {
    const startedAt = Date.now();
    let usersProcessed = 0;
    let recordsCreated = 0;
    let pushed = 0;

    let cursor: Types.ObjectId | null = null;

    for (;;) {
      const filter: Record<string, unknown> = {
        accountStatus: AccountStatus.Active,
        ...(cursor ? { _id: { $gt: cursor } } : {}),
      };

      const page: { _id: Types.ObjectId }[] = await this.userModel
        .find(filter)
        .select({ _id: 1 })
        .sort({ _id: 1 })
        .limit(BROADCAST_PAGE_SIZE)
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      if (page.length === 0) break;

      const ids = page.map((u) => u._id);

      try {
        const res = await this.notifications.createAndPush(
          ids,
          () => ({
            type: NotificationType.AdminBroadcast,
            title,
            body: message,
          }),
          null,
        );
        recordsCreated += res.recordsCreated;
        pushed += res.pushed;
      } catch (err) {
        this.logger.error(
          `Broadcast page starting at ${ids[0].toString()} failed: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }

      usersProcessed += page.length;
      cursor = ids[ids.length - 1];

      this.logger.log(
        `Broadcast progress: ${usersProcessed} user(s) processed, ` +
          `${recordsCreated} record(s), ${pushed} push(es)`,
      );

      if (page.length < BROADCAST_PAGE_SIZE) break;
    }

    const elapsedMs = Date.now() - startedAt;
    this.logger.log(
      `Broadcast complete: ${usersProcessed} user(s), ${recordsCreated} ` +
        `record(s), ${pushed} push(es), ${elapsedMs}ms`,
    );

    return { usersProcessed, recordsCreated, pushed, elapsedMs };
  }
}
