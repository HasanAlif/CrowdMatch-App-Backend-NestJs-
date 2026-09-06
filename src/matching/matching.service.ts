import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';

import { Match, MatchDecision, MatchStatus } from './schemas/match.schema';
import { Vote, VoteType } from './schemas/vote.schema';
import { MatchCycleCheckpoint } from './schemas/match-cycle-checkpoint.schema';
import { MatchedPair, PairOutcome } from './schemas/matched-pair.schema';
import { User } from '../user/schemas/user.schema';
import { AccountStatus } from '../user/user.types';

const SOFT_MAX_MATCHES_PER_CYCLE = 2;

const BACKFILL_BATCH_SIZE = 1000;

const CANDIDATE_BUILD_CONCURRENCY = 8;

const MAX_CANDIDATES_PER_USER = 200;

const INSERT_CHUNK_SIZE = 2000;

const VOTE_PREFETCH_MARGIN_MS = 60 * 60 * 1000;

const ELIGIBLE_USER_FIELDS = {
  _id: 1,
  gender: 1,
  interestedInGenders: 1,
  age: 1,
  dateOfBirth: 1,
  minAgePreference: 1,
  maxAgePreference: 1,
  maxDistanceKm: 1,
  geoLocation: 1,
  blockedUsers: 1,
  photos: 1,
};

interface EligibleUser {
  _id: Types.ObjectId;
  gender: string;
  interestedInGenders: string[];
  age?: number;
  dateOfBirth?: Date;
  minAgePreference: number;
  maxAgePreference: number;
  maxDistanceKm: number;
  geoLocation: { type: 'Point'; coordinates: [number, number] };
  blockedUsers: Types.ObjectId[];
  photos: unknown[];
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Vote.name) private readonly voteModel: Model<Vote>,
    @InjectModel(MatchCycleCheckpoint.name)
    private readonly checkpointModel: Model<MatchCycleCheckpoint>,
    @InjectModel(MatchedPair.name)
    private readonly matchedPairModel: Model<MatchedPair>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  getUserAge(user: { age?: number; dateOfBirth?: Date }): number | null {
    if (user.age != null) return user.age;
    if (user.dateOfBirth) {
      const today = new Date();
      const dob = new Date(user.dateOfBirth);
      let computed = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < dob.getDate())
      ) {
        computed--;
      }
      return computed;
    }
    return null;
  }

  async areUsersBlocked(
    userAId: Types.ObjectId,
    userBId: Types.ObjectId,
  ): Promise<boolean> {
    const [userA, userB] = await Promise.all([
      this.userModel.findById(userAId).select('blockedUsers').lean().exec(),
      this.userModel.findById(userBId).select('blockedUsers').lean().exec(),
    ]);

    if (!userA || !userB) return true;

    const aBlockedB = (userA.blockedUsers ?? []).some((id) =>
      id.equals(userBId),
    );
    const bBlockedA = (userB.blockedUsers ?? []).some((id) =>
      id.equals(userAId),
    );

    return aBlockedB || bBlockedA;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    const runner = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, runner),
    );

    return results;
  }

  private normalisePair(
    a: Types.ObjectId,
    b: Types.ObjectId,
  ): [Types.ObjectId, Types.ObjectId] {
    return a.toString() < b.toString() ? [a, b] : [b, a];
  }

  // MATCH GENERATION ALGORITHM

  private async getEligibleUsers(): Promise<EligibleUser[]> {
    return this.userModel
      .find({
        isVerified: true,
        accountStatus: AccountStatus.Active,
        gender: { $exists: true, $ne: null },
        interestedInGenders: { $exists: true, $not: { $size: 0 } },
        geoLocation: { $exists: true, $ne: null },
        maxDistanceKm: { $exists: true, $ne: null },
        minAgePreference: { $exists: true, $ne: null },
        maxAgePreference: { $exists: true, $ne: null },
        'photos.0': { $exists: true },
        $or: [
          { age: { $exists: true, $ne: null } },
          { dateOfBirth: { $exists: true, $ne: null } },
        ],
      })
      .select(ELIGIBLE_USER_FIELDS)
      .lean<EligibleUser[]>()
      .exec();
  }

  private async findCompatibleCandidates(
    user: EligibleUser,
    allEligibleIds: Set<string>,
    existingActivePairs: Set<string>,
    permanentlyRejectedPairs: Set<string>,
  ): Promise<Types.ObjectId[]> {
    const userAge = this.getUserAge(user);
    if (userAge == null) return [];

    const buildPipeline = (limit: number | null): PipelineStage[] => {
      const stages: PipelineStage[] = [
        {
          $geoNear: {
            near: user.geoLocation,
            distanceField: 'dist_meters',
            maxDistance: user.maxDistanceKm * 1000,
            spherical: true,
            query: {
              _id: { $ne: user._id },
              isVerified: true,
              accountStatus: AccountStatus.Active,
              gender: { $in: user.interestedInGenders },
              interestedInGenders: user.gender,
              'photos.0': { $exists: true },
              minAgePreference: { $lte: userAge },
              maxAgePreference: { $gte: userAge },
              $or: [
                { age: { $exists: true, $ne: null } },
                { dateOfBirth: { $exists: true, $ne: null } },
              ],
            },
          },
        },
      ];

      if (limit !== null) stages.push({ $limit: limit });

      stages.push({
        $project: {
          ...ELIGIBLE_USER_FIELDS,
          dist_meters: 1,
        },
      });

      return stages;
    };

    let candidates = await this.userModel
      .aggregate<EligibleUser & { dist_meters: number }>(
        buildPipeline(MAX_CANDIDATES_PER_USER),
      )
      .exec();

    let capWasBinding = candidates.length >= MAX_CANDIDATES_PER_USER;
    let compatible = this.filterCompatible(
      user,
      userAge,
      candidates,
      allEligibleIds,
      existingActivePairs,
      permanentlyRejectedPairs,
    );

    if (compatible.length === 0 && capWasBinding) {
      this.logger.warn(
        `Candidate cap starved user ${user._id.toString()} — retrying uncapped`,
      );
      candidates = await this.userModel
        .aggregate<EligibleUser & { dist_meters: number }>(buildPipeline(null))
        .exec();
      capWasBinding = false;
      compatible = this.filterCompatible(
        user,
        userAge,
        candidates,
        allEligibleIds,
        existingActivePairs,
        permanentlyRejectedPairs,
      );
    }

    return compatible;
  }

  private filterCompatible(
    user: EligibleUser,
    userAge: number,
    candidates: Array<EligibleUser & { dist_meters: number }>,
    allEligibleIds: Set<string>,
    existingActivePairs: Set<string>,
    permanentlyRejectedPairs: Set<string>,
  ): Types.ObjectId[] {
    const compatible: Types.ObjectId[] = [];

    for (const candidate of candidates) {
      const candidateId = candidate._id.toString();

      if (!allEligibleIds.has(candidateId)) continue;

      const candidateAge = this.getUserAge(candidate);
      if (candidateAge == null) continue;

      if (
        userAge < candidate.minAgePreference ||
        userAge > candidate.maxAgePreference
      )
        continue;
      if (
        candidateAge < user.minAgePreference ||
        candidateAge > user.maxAgePreference
      )
        continue;

      const distanceKm = candidate.dist_meters / 1000;
      if (distanceKm > candidate.maxDistanceKm) continue;

      const [u1, u2] = this.normalisePair(user._id, candidate._id);
      const pairKey = `${u1.toString()}:${u2.toString()}`;
      if (existingActivePairs.has(pairKey)) continue;

      if (permanentlyRejectedPairs.has(pairKey)) continue;

      const userBlocked = (user.blockedUsers ?? []).some((id) =>
        id.equals(candidate._id),
      );
      const candidateBlocked = (candidate.blockedUsers ?? []).some((id) =>
        id.equals(user._id),
      );
      if (userBlocked || candidateBlocked) continue;

      compatible.push(candidate._id);
    }

    return compatible;
  }

  async generateMatches(expiresAt: Date): Promise<number> {
    const eligibleUsers = await this.getEligibleUsers();
    if (eligibleUsers.length < 2) {
      this.logger.log(
        `Match generation skipped: only ${eligibleUsers.length} eligible user(s)`,
      );
      return 0;
    }

    const allEligibleIds = new Set(eligibleUsers.map((u) => u._id.toString()));

    const activeMatches = await this.matchModel
      .find({ isExpired: false })
      .select('user1 user2')
      .lean()
      .exec();

    const existingActivePairs = new Set<string>();
    for (const m of activeMatches) {
      const [u1, u2] = this.normalisePair(m.user1, m.user2);
      existingActivePairs.add(`${u1.toString()}:${u2.toString()}`);
    }

    const eligibleObjectIds = eligibleUsers.map((u) => u._id);

    const rejectedPairDocs = await this.matchedPairModel
      .find({
        outcome: PairOutcome.Rejected,
        user1: { $in: eligibleObjectIds },
        user2: { $in: eligibleObjectIds },
      })
      .select('user1 user2')
      .lean()
      .exec();

    const permanentlyRejectedPairs = new Set<string>();
    for (const p of rejectedPairDocs ?? []) {
      const [u1, u2] = this.normalisePair(p.user1, p.user2);
      permanentlyRejectedPairs.add(`${u1.toString()}:${u2.toString()}`);
    }

    const candidateMap = new Map<string, Types.ObjectId[]>();

    const candidateLists = await this.mapWithConcurrency(
      eligibleUsers,
      CANDIDATE_BUILD_CONCURRENCY,
      (user) =>
        this.findCompatibleCandidates(
          user,
          allEligibleIds,
          existingActivePairs,
          permanentlyRejectedPairs,
        ),
    );

    eligibleUsers.forEach((user, i) => {
      candidateMap.set(user._id.toString(), candidateLists[i]);
    });

    const sortedUsers = [...eligibleUsers].sort((a, b) => {
      const aCount = candidateMap.get(a._id.toString())?.length ?? 0;
      const bCount = candidateMap.get(b._id.toString())?.length ?? 0;
      return aCount - bCount;
    });

    const matchCountThisCycle = new Map<string, number>();
    const pairsToCreate: [Types.ObjectId, Types.ObjectId][] = [];
    const pairedThisCycle = new Set<string>();

    const unmatchedAfterFirstPass: EligibleUser[] = [];

    for (const user of sortedUsers) {
      const userId = user._id.toString();
      if ((matchCountThisCycle.get(userId) ?? 0) >= 1) continue;

      const candidates = candidateMap.get(userId) ?? [];

      const availableCandidates = candidates.filter((cId) => {
        const cStr = cId.toString();
        if ((matchCountThisCycle.get(cStr) ?? 0) >= 1) return false;
        const [u1, u2] = this.normalisePair(user._id, cId);
        return !pairedThisCycle.has(`${u1.toString()}:${u2.toString()}`);
      });

      if (availableCandidates.length === 0) {
        unmatchedAfterFirstPass.push(user);
        continue;
      }

      const randomIdx = Math.floor(Math.random() * availableCandidates.length);
      const chosenCandidate = availableCandidates[randomIdx];
      const [u1, u2] = this.normalisePair(user._id, chosenCandidate);
      const pairKey = `${u1.toString()}:${u2.toString()}`;

      pairsToCreate.push([u1, u2]);
      pairedThisCycle.add(pairKey);
      matchCountThisCycle.set(
        userId,
        (matchCountThisCycle.get(userId) ?? 0) + 1,
      );
      matchCountThisCycle.set(
        chosenCandidate.toString(),
        (matchCountThisCycle.get(chosenCandidate.toString()) ?? 0) + 1,
      );
    }

    for (const user of unmatchedAfterFirstPass) {
      const userId = user._id.toString();
      if ((matchCountThisCycle.get(userId) ?? 0) >= SOFT_MAX_MATCHES_PER_CYCLE)
        continue;

      const candidates = candidateMap.get(userId) ?? [];

      const availableCandidates = candidates.filter((cId) => {
        const cStr = cId.toString();
        if ((matchCountThisCycle.get(cStr) ?? 0) >= SOFT_MAX_MATCHES_PER_CYCLE)
          return false;
        const [u1, u2] = this.normalisePair(user._id, cId);
        return !pairedThisCycle.has(`${u1.toString()}:${u2.toString()}`);
      });

      if (availableCandidates.length === 0) continue;

      const randomIdx = Math.floor(Math.random() * availableCandidates.length);
      const chosenCandidate = availableCandidates[randomIdx];
      const [u1, u2] = this.normalisePair(user._id, chosenCandidate);
      const pairKey = `${u1.toString()}:${u2.toString()}`;

      pairsToCreate.push([u1, u2]);
      pairedThisCycle.add(pairKey);
      matchCountThisCycle.set(
        userId,
        (matchCountThisCycle.get(userId) ?? 0) + 1,
      );
      matchCountThisCycle.set(
        chosenCandidate.toString(),
        (matchCountThisCycle.get(chosenCandidate.toString()) ?? 0) + 1,
      );
    }

    let capOverrides = 0;

    for (const user of sortedUsers) {
      const userId = user._id.toString();

      if ((matchCountThisCycle.get(userId) ?? 0) > 0) continue;

      const candidates = candidateMap.get(userId) ?? [];
      if (candidates.length === 0) continue;
      const availableCandidates = candidates.filter((cId) => {
        const [u1, u2] = this.normalisePair(user._id, cId);
        return !pairedThisCycle.has(`${u1.toString()}:${u2.toString()}`);
      });

      if (availableCandidates.length === 0) continue;

      let chosenCandidate = availableCandidates[0];
      let lowestLoad = matchCountThisCycle.get(chosenCandidate.toString()) ?? 0;

      for (const cId of availableCandidates) {
        const load = matchCountThisCycle.get(cId.toString()) ?? 0;
        if (load < lowestLoad) {
          chosenCandidate = cId;
          lowestLoad = load;
        }
      }

      const [u1, u2] = this.normalisePair(user._id, chosenCandidate);
      const pairKey = `${u1.toString()}:${u2.toString()}`;

      pairsToCreate.push([u1, u2]);
      pairedThisCycle.add(pairKey);
      matchCountThisCycle.set(
        userId,
        (matchCountThisCycle.get(userId) ?? 0) + 1,
      );
      matchCountThisCycle.set(
        chosenCandidate.toString(),
        (matchCountThisCycle.get(chosenCandidate.toString()) ?? 0) + 1,
      );

      if (lowestLoad >= SOFT_MAX_MATCHES_PER_CYCLE) {
        capOverrides++;
        this.logger.warn(
          `Coverage sweep: user ${userId} had no uncapped candidate — ` +
            `pairing with ${chosenCandidate.toString()} at ${lowestLoad} ` +
            `matches, exceeding the soft cap of ${SOFT_MAX_MATCHES_PER_CYCLE}. ` +
            `Leaving a user unmatched is never acceptable; the cap is soft.`,
        );
      }
    }

    if (capOverrides > 0) {
      this.logger.warn(
        `Coverage sweep exceeded the soft cap ${capOverrides} time(s) ` +
          `to guarantee every user with a compatible candidate got a match. ` +
          `Sustained overrides indicate a severely imbalanced pool.`,
      );
    }

    if (pairsToCreate.length === 0) {
      this.logger.log('Match generation completed: 0 pairs created');
      return 0;
    }

    const matchDocs = pairsToCreate.map(([u1, u2]) => ({
      user1: u1,
      user2: u2,
      user1Decision: MatchDecision.Pending,
      user2Decision: MatchDecision.Pending,
      matchStatus: MatchStatus.Pending,
      totalVoteCount: 0,
      positiveVoteCount: 0,
      negativeVoteCount: 0,
      isExpired: false,
      expiresAt,
    }));

    const failedIndexes = new Set<number>();

    for (
      let offset = 0;
      offset < matchDocs.length;
      offset += INSERT_CHUNK_SIZE
    ) {
      const chunk = matchDocs.slice(offset, offset + INSERT_CHUNK_SIZE);

      try {
        await this.matchModel.insertMany(chunk, { ordered: false });
      } catch (err: any) {
        const writeErrors = err?.writeErrors ?? err?.result?.writeErrors;

        if (!writeErrors && err?.code !== 11000) throw err;

        for (const e of writeErrors ?? []) {
          const localIndex = e?.index ?? e?.err?.index;
          if (typeof localIndex === 'number') {
            failedIndexes.add(offset + localIndex);
          }
        }
      }
    }

    const insertedPairs = pairsToCreate.filter((_, i) => !failedIndexes.has(i));

    if (failedIndexes.size > 0) {
      this.logger.warn(
        `Match insert partially failed: ${failedIndexes.size} of ` +
          `${pairsToCreate.length} pair(s) rejected (likely the partial ` +
          `unique index catching a concurrently-created active match). ` +
          `Continuing with ${insertedPairs.length}.`,
      );
    }

    await this.recordPairsMatched(insertedPairs);

    this.logger.log(
      `Match generation completed: ${insertedPairs.length} pairs created`,
    );
    return insertedPairs.length;
  }

  private async recordPairsMatched(
    pairs: [Types.ObjectId, Types.ObjectId][],
  ): Promise<void> {
    if (pairs.length === 0) return;

    const now = new Date();

    const ops = pairs.map(([u1, u2]) => ({
      updateOne: {
        filter: { user1: u1, user2: u2 },
        update: {
          $setOnInsert: {
            user1: u1,
            user2: u2,
            outcome: PairOutcome.Pending,
            firstMatchedAt: now,
          },
          $set: { lastMatchedAt: now, decisionVersion: 0 },
          $inc: { matchCount: 1 },
        },
        upsert: true,
      },
    }));

    await this.matchedPairModel.bulkWrite(ops, { ordered: false });
  }

  // CRON CYCLE
  async expireAndRegenerate(): Promise<void> {
    await this.backfillPairHistoryOnce();

    const expireResult = await this.matchModel.updateMany(
      { isExpired: false },
      { $set: { isExpired: true } },
    );
    this.logger.log(`Expired ${expireResult.modifiedCount} active matches`);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const pairsCreated = await this.generateMatches(expiresAt);
    this.logger.log(
      `Cycle complete: expired ${expireResult.modifiedCount}, generated ${pairsCreated} new matches`,
    );

    await this.checkpointModel
      .findOneAndUpdate(
        { _id: 'singleton' },
        { $set: { lastCycleRunAt: new Date() } },
        { upsert: true },
      )
      .exec();
  }

  private async backfillPairHistoryOnce(): Promise<void> {
    const checkpoint = await this.checkpointModel
      .findById('singleton')
      .lean()
      .exec();

    if (checkpoint?.pairHistoryBackfilledAt) return;

    this.logger.log('Pair-history backfill: starting one-time migration…');

    const cursor = this.matchModel
      .find({ matchStatus: MatchStatus.Rejected })
      .select('user1 user2 createdAt updatedAt')
      .lean()
      .cursor();

    let ops: any[] = [];
    let total = 0;

    const flush = async () => {
      if (ops.length === 0) return;
      await this.matchedPairModel.bulkWrite(ops, { ordered: false });
      total += ops.length;
      ops = [];
    };

    for await (const m of cursor as any) {
      const [u1, u2] = this.normalisePair(m.user1, m.user2);
      const rejectedAt = m.updatedAt ?? m.createdAt ?? new Date();

      ops.push({
        updateOne: {
          filter: { user1: u1, user2: u2 },
          update: {
            $setOnInsert: {
              user1: u1,
              user2: u2,
              firstMatchedAt: m.createdAt ?? rejectedAt,
              matchCount: 1,
            },
            $set: {
              outcome: PairOutcome.Rejected,
              rejectedAt,
              lastMatchedAt: m.createdAt ?? rejectedAt,
            },
          },
          upsert: true,
        },
      });

      if (ops.length >= BACKFILL_BATCH_SIZE) await flush();
    }

    await flush();

    await this.checkpointModel
      .findOneAndUpdate(
        { _id: 'singleton' },
        { $set: { pairHistoryBackfilledAt: new Date() } },
        { upsert: true },
      )
      .exec();

    this.logger.log(
      `Pair-history backfill: migrated ${total} historical rejection(s)`,
    );
  }

  async getLastCycleRunAt(): Promise<Date | null> {
    const checkpoint = await this.checkpointModel
      .findById('singleton')
      .lean()
      .exec();
    return checkpoint?.lastCycleRunAt ?? null;
  }

  // VOTING FEED  —  GET /matching
  private async getVotedMatchIdsThisCycle(
    voter: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const lastCycleRunAt = await this.getLastCycleRunAt();

    const filter: Record<string, unknown> = { voter };
    if (lastCycleRunAt) {
      filter.createdAt = {
        $gte: new Date(lastCycleRunAt.getTime() - VOTE_PREFETCH_MARGIN_MS),
      };
    }

    const votes = await this.voteModel
      .find(filter)
      .select('match')
      .lean()
      .exec();

    return votes.map((v) => v.match);
  }

  async getVotingFeed(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    matches: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const userOid = new Types.ObjectId(userId);
    const votedIds = await this.getVotedMatchIdsThisCycle(userOid);

    const filter: Record<string, unknown> = {
      isExpired: false,
      user1: { $ne: userOid },
      user2: { $ne: userOid },
    };
    if (votedIds.length > 0) {
      filter._id = { $nin: votedIds };
    }
    const [total, rows] = await Promise.all([
      this.matchModel.countDocuments(filter),
      this.matchModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'user1', select: '_id photos' })
        .populate({ path: 'user2', select: '_id photos' })
        .lean()
        .exec(),
    ]);

    const matches = rows.map((match: any) => ({
      matchId: match._id,
      user1: {
        id: match.user1?._id,
        photo: match.user1?.photos?.[0] ?? null,
      },
      user2: {
        id: match.user2?._id,
        photo: match.user2?.photos?.[0] ?? null,
      },
      totalVoteCount: match.totalVoteCount,
      positiveVoteCount: match.positiveVoteCount,
      negativeVoteCount: match.negativeVoteCount,
    }));

    return {
      matches,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  // MY MATCHES  —  GET /matching/mine

  async getMyMatches(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    matches: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const userOid = new Types.ObjectId(userId);

    const filter = {
      isExpired: false,
      $or: [{ user1: userOid }, { user2: userOid }],
    };

    const [total, rawMatches] = await Promise.all([
      this.matchModel.countDocuments(filter),
      this.matchModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: 'user1',
          select: '_id photos',
        })
        .populate({
          path: 'user2',
          select: '_id photos',
        })
        .lean()
        .exec(),
    ]);

    const matches = rawMatches.map((match: any) => {
      const isUser1 = match.user1?._id?.toString() === userId;
      const me = isUser1 ? match.user1 : match.user2;
      const otherUser = isUser1 ? match.user2 : match.user1;
      const myDecision = isUser1 ? match.user1Decision : match.user2Decision;

      return {
        matchId: match._id,
        myDetails: {
          id: me?._id,
          photo: me?.photos?.[0] ?? null,
        },
        otherUser: {
          id: otherUser?._id,
          photo: otherUser?.photos?.[0] ?? null,
        },
        myDecision,
        matchStatus: match.matchStatus,
      };
    });

    return {
      matches,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  // DECISION  —  PATCH /matching/:id/decision

  async updateDecision(
    matchId: string,
    userId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<{ matchId: string; myDecision: string; matchStatus: string }> {
    const match = await this.matchModel.findById(matchId).exec();

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    if (match.isExpired) {
      throw new GoneException('This match has expired');
    }

    const userOid = new Types.ObjectId(userId);
    const isUser1 = match.user1.equals(userOid);
    const isUser2 = match.user2.equals(userOid);

    if (!isUser1 && !isUser2) {
      throw new ForbiddenException('You are not a participant in this match');
    }

    const myField = isUser1 ? 'user1Decision' : 'user2Decision';

    const updated = await this.matchModel
      .findOneAndUpdate(
        { _id: match._id, isExpired: false },
        [
          { $set: { [myField]: decision } },
          {
            $set: {
              matchStatus: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $or: [
                          { $eq: ['$user1Decision', MatchDecision.Rejected] },
                          { $eq: ['$user2Decision', MatchDecision.Rejected] },
                        ],
                      },
                      then: MatchStatus.Rejected,
                    },
                    {
                      case: {
                        $and: [
                          { $eq: ['$user1Decision', MatchDecision.Accepted] },
                          { $eq: ['$user2Decision', MatchDecision.Accepted] },
                        ],
                      },
                      then: MatchStatus.Mutual,
                    },
                  ],
                  default: MatchStatus.Pending,
                },
              },
              decisionVersion: {
                $add: [{ $ifNull: ['$decisionVersion', 0] }, 1],
              },
            },
          },
        ],
        { new: true, updatePipeline: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new GoneException('This match has expired');
    }

    await this.recordPairDecision(
      updated.user1,
      updated.user2,
      updated.matchStatus,
      userOid,
      updated.decisionVersion,
    );

    return {
      matchId: updated._id.toString(),
      myDecision: decision,
      matchStatus: updated.matchStatus,
    };
  }

  // MY ACCEPTED MATCHES  —  GET /matching/mine/accepted
  async getMyAcceptedMatches(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    matches: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const userOid = new Types.ObjectId(userId);

    const mutualFilter = {
      $or: [{ user1: userOid }, { user2: userOid }],
      outcome: PairOutcome.Mutual,
    };

    const awaitingFilter = {
      isExpired: false,
      $or: [
        {
          user1: userOid,
          user1Decision: MatchDecision.Accepted,
          user2Decision: MatchDecision.Pending,
        },
        {
          user2: userOid,
          user2Decision: MatchDecision.Accepted,
          user1Decision: MatchDecision.Pending,
        },
      ],
    };

    // Whichever side of the pair is not me.
    const otherUserId = {
      $cond: [{ $eq: ['$user1', userOid] }, '$user2', '$user1'],
    };

    const [mutualCount, awaitingCount, rows] = await Promise.all([
      this.matchedPairModel.countDocuments(mutualFilter),
      this.matchModel.countDocuments(awaitingFilter),
      this.matchedPairModel
        .aggregate([
          { $match: mutualFilter },
          {
            $project: {
              _id: 0,
              otherUserId,
              status: { $literal: MatchStatus.Mutual },
              matchId: { $literal: null },
              sortAt: { $ifNull: ['$lastMatchedAt', '$firstMatchedAt'] },
            },
          },
          {
            $unionWith: {
              coll: this.matchModel.collection.name,
              pipeline: [
                { $match: awaitingFilter },
                {
                  $project: {
                    _id: 0,
                    otherUserId,
                    status: { $literal: MatchStatus.Pending },
                    matchId: '$_id',
                    sortAt: '$createdAt',
                  },
                },
              ],
            },
          },
          { $sort: { sortAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          // Runs on at most `limit` documents, not once per candidate row.
          {
            $lookup: {
              from: this.userModel.collection.name,
              localField: 'otherUserId',
              foreignField: '_id',
              as: 'otherUser',
              pipeline: [
                { $project: { _id: 1, fullName: 1, displayId: 1, photos: 1 } },
              ],
            },
          },
          { $unwind: '$otherUser' },
        ])
        .exec(),
    ]);

    const total = mutualCount + awaitingCount;

    const matches = rows.map((row: any) => ({
      matchId: row.matchId ?? null,
      otherUser: {
        id: row.otherUser?._id,
        fullName: row.otherUser?.fullName,
        photo: row.otherUser?.photos?.[0] ?? null,
      },
      status: row.status,
    }));

    return {
      matches,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  private async recordPairDecision(
    userA: Types.ObjectId,
    userB: Types.ObjectId,
    status: MatchStatus,
    decidedBy: Types.ObjectId,
    version: number,
  ): Promise<void> {
    const [u1, u2] = this.normalisePair(userA, userB);
    const now = new Date();

    const outcome =
      status === MatchStatus.Rejected
        ? PairOutcome.Rejected
        : status === MatchStatus.Mutual
          ? PairOutcome.Mutual
          : PairOutcome.Pending;

    const isNewer = {
      $gt: [version, { $ifNull: ['$decisionVersion', -1] }],
    };

    const keep = (field: string) => ({ $ifNull: [`$${field}`, '$$REMOVE'] });

    await this.matchedPairModel
      .updateOne(
        { user1: u1, user2: u2 },
        [
          {
            $set: {
              user1: u1,
              user2: u2,
              firstMatchedAt: { $ifNull: ['$firstMatchedAt', now] },
              lastMatchedAt: { $ifNull: ['$lastMatchedAt', now] },
              matchCount: { $ifNull: ['$matchCount', 1] },

              outcome: { $cond: [isNewer, outcome, keep('outcome')] },

              rejectedAt: {
                $cond: [
                  isNewer,
                  status === MatchStatus.Rejected ? now : '$$REMOVE',
                  keep('rejectedAt'),
                ],
              },
              rejectedBy: {
                $cond: [
                  isNewer,
                  status === MatchStatus.Rejected ? decidedBy : '$$REMOVE',
                  keep('rejectedBy'),
                ],
              },

              decisionVersion: {
                $max: [version, { $ifNull: ['$decisionVersion', -1] }],
              },
            },
          },
        ],
        { upsert: true, updatePipeline: true },
      )
      .exec();
  }

  // VOTE  —  POST /matching/vote?matchId=<id>

  async castVote(
    matchId: string,
    voterId: string,
    voteType: 'positive' | 'negative',
  ): Promise<{ voteId: string; matchId: string; voteType: string }> {
    const match = await this.matchModel
      .findById(matchId)
      .select('_id user1 user2 isExpired')
      .lean()
      .exec();

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    if (match.isExpired) {
      throw new GoneException('This match has expired');
    }

    const voterOid = new Types.ObjectId(voterId);

    if (match.user1.equals(voterOid) || match.user2.equals(voterOid)) {
      throw new ForbiddenException('You cannot vote on your own match');
    }

    let vote;
    try {
      vote = await this.voteModel.create({
        voter: voterOid,
        match: new Types.ObjectId(matchId),
        voteType: voteType as VoteType,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException('You have already voted on this match');
      }
      throw err;
    }

    const incUpdate: Record<string, number> = { totalVoteCount: 1 };
    if (voteType === 'positive') {
      incUpdate.positiveVoteCount = 1;
    } else {
      incUpdate.negativeVoteCount = 1;
    }

    await this.matchModel
      .findByIdAndUpdate(matchId, { $inc: incUpdate })
      .exec();

    return {
      voteId: vote._id.toString(),
      matchId,
      voteType,
    };
  }

  // MY VOTE COUNT  —  GET /matching/mine/vote-count

  /** Total votes this user has ever cast, across every match, expired or not. */
  async getMyVoteCount(userId: string): Promise<{ totalVotes: number }> {
    const totalVotes = await this.voteModel.countDocuments({
      voter: new Types.ObjectId(userId),
    });

    return { totalVotes };
  }
}
