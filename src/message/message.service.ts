import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Conversation } from './schemas/conversation.schema';
import { Report, ReportDocument } from './schemas/report.schema';
import { ReportReason } from './schemas/report.schema';
import {
  ChatPermission,
  CHAT_DENIAL_COPY,
  decideChatPermission,
} from './message-copy';
import { User } from '../user/schemas/user.schema';
import { AccountStatus } from '../user/user.types';
import {
  MatchedPair,
  PairOutcome,
} from '../matching/schemas/matched-pair.schema';
import { normalisePair } from '../common/pair';

interface AggregatedConversation {
  partner: { _id: Types.ObjectId; [key: string]: unknown };
  partnerBlockedRequester: boolean;
  lastMessage: Record<string, unknown>;
  unreadCount: number;
}

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(MatchedPair.name)
    private readonly matchedPairModel: Model<MatchedPair>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
  ) {}

  async setOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    const update: Record<string, unknown> = { isOnline };
    if (!isOnline) update.lastSeen = new Date();

    await this.userModel.findByIdAndUpdate(userId, { $set: update }).exec();
  }

  async saveMessage(data: {
    senderId: string;
    receiverId: string;
    text?: string;
    images?: { url: string; publicId: string }[];
    clientMessageId?: string;
  }): Promise<MessageDocument> {
    await this.assertCanChat(data.senderId, data.receiverId);

    const senderOid = new Types.ObjectId(data.senderId);
    const receiverOid = new Types.ObjectId(data.receiverId);

    const message = await this.messageModel.create({
      sender: senderOid,
      receiver: receiverOid,
      text: data.text,
      images: data.images ?? [],
      clientMessageId: data.clientMessageId,
    });

    const createdAt = (message as MessageDocument & { createdAt: Date })
      .createdAt;

    const [user1, user2] = normalisePair(senderOid, receiverOid);
    const recipientIsUser1 = user1.equals(receiverOid);

    await this.conversationModel.updateOne(
      { participants: [user1, user2] },
      {
        $set: {
          lastMessageAt: createdAt,
          lastMessage: {
            messageId: message._id,
            text: message.text,
            sender: senderOid,
            images: message.images ?? [],
            isRead: false,
            createdAt,
          },
        },
        $inc: { [recipientIsUser1 ? 'unreadForUser1' : 'unreadForUser2']: 1 },
      },
      { upsert: true },
    );

    return message;
  }

  // ── Mark read ──
  async markRead(viewerId: string, senderId: string): Promise<number> {
    const viewerOid = new Types.ObjectId(viewerId);
    const senderOid = new Types.ObjectId(senderId);

    const result = await this.messageModel.updateMany(
      {
        sender: senderOid,
        receiver: viewerOid,
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } },
    );

    const [user1, user2] = normalisePair(viewerOid, senderOid);
    const viewerIsUser1 = user1.equals(viewerOid);

    await this.conversationModel.updateOne(
      { participants: [user1, user2] },
      {
        $set: {
          [viewerIsUser1 ? 'unreadForUser1' : 'unreadForUser2']: 0,
          ...(result.modifiedCount > 0 ? { 'lastMessage.isRead': true } : {}),
        },
      },
    );

    return result.modifiedCount;
  }

  // ── Unread count ──
  async getUnreadCount(userId: string): Promise<number> {
    return this.messageModel.countDocuments({
      receiver: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  // ── Paginated history ──
  async getHistory(
    userId: string,
    otherId: string,
    page: number,
    limit: number,
  ): Promise<{
    messages: unknown[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const userOid = new Types.ObjectId(userId);
    const otherOid = new Types.ObjectId(otherId);

    const filter = {
      $or: [
        { sender: userOid, receiver: otherOid },
        { sender: otherOid, receiver: userOid },
      ],
    };

    const [total, rawMessages] = await Promise.all([
      this.messageModel.countDocuments(filter),
      this.messageModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    // Reverse so the page is presented oldest-first (how a chat UI reads).
    const messages = [...rawMessages].reverse();

    return {
      messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Conversation list (inbox) ─────────────────────────────────────────────

  async getConversations(
    userId: string,
    page?: number,
    limit?: number,
  ): Promise<unknown[]> {
    const userOid = new Types.ObjectId(userId);

    const requesterIsUser1 = {
      $eq: [{ $arrayElemAt: ['$participants', 0] }, userOid],
    };

    const pipeline: PipelineStage[] = [
      // 1. This user's conversations, newest first — index-provided sort.
      { $match: { participants: userOid } },
      { $sort: { lastMessageAt: -1 } },
    ];

    // 2. Bound the page before anything expensive happens.
    if (limit != null) {
      const skip = ((page ?? 1) - 1) * limit;
      if (skip > 0) pipeline.push({ $skip: skip });
      pipeline.push({ $limit: limit });
    }

    pipeline.push(
      // 3. Resolve the partner id and this user's side of the counter.
      {
        $addFields: {
          partnerId: {
            $cond: [
              requesterIsUser1,
              { $arrayElemAt: ['$participants', 1] },
              { $arrayElemAt: ['$participants', 0] },
            ],
          },
          unreadCount: {
            $cond: [requesterIsUser1, '$unreadForUser1', '$unreadForUser2'],
          },
        },
      },

      // 4. Join partner's profile — bounded by page size, after the limit.
      {
        $lookup: {
          from: 'users',
          localField: 'partnerId',
          foreignField: '_id',
          as: 'partner',
          pipeline: [
            {
              $project: {
                _id: 1,
                fullName: 1,
                picture: 1,
                isOnline: 1,
                lastSeen: 1,
                displayId: 1,
                blockedRequester: {
                  $in: [userOid, { $ifNull: ['$blockedUsers', []] }],
                },
              },
            },
          ] as Exclude<
            PipelineStage,
            PipelineStage.Merge | PipelineStage.Out
          >[],
        },
      },
      { $unwind: '$partner' },

      // 5. Project to exactly the shape the endpoint has always returned.
      {
        $project: {
          _id: 0,
          partner: {
            _id: '$partner._id',
            fullName: '$partner.fullName',
            picture: '$partner.picture',
            isOnline: '$partner.isOnline',
            lastSeen: '$partner.lastSeen',
            displayId: '$partner.displayId',
          },
          partnerBlockedRequester: {
            $ifNull: ['$partner.blockedRequester', false],
          },
          lastMessage: {
            _id: '$lastMessage.messageId',
            text: '$lastMessage.text',
            images: '$lastMessage.images',
            isRead: '$lastMessage.isRead',
            createdAt: '$lastMessage.createdAt',
            sender: '$lastMessage.sender',
          },
          unreadCount: 1,
        },
      },
    );

    let rows: AggregatedConversation[];
    try {
      rows = await this.conversationModel
        .aggregate<AggregatedConversation>(pipeline)
        .exec();
    } catch (err) {
      this.logger.error('getConversations aggregation failed', err);
      throw new InternalServerErrorException('Failed to load conversations');
    }

    if (rows.length === 0) return [];

    const partnerIds = rows.map((r) => r.partner._id);

    const [requester, outcomes] = await Promise.all([
      this.userModel.findById(userOid).select('blockedUsers').lean().exec(),
      this.findPairOutcomes(userOid, partnerIds),
    ]);

    const requesterBlocked = new Set(
      (requester?.blockedUsers ?? []).map((id) => id.toString()),
    );

    return rows.map((row) => {
      const partnerId = row.partner._id.toString();

      const permission = decideChatPermission({
        senderExists: true,
        receiverExists: true,
        senderBlockedReceiver: requesterBlocked.has(partnerId),
        receiverBlockedSender: row.partnerBlockedRequester,
        outcome: outcomes.get(partnerId),
      });

      const base = {
        partner: row.partner,
        lastMessage: row.lastMessage,
        unreadCount: row.unreadCount,
      };

      return permission.allowed
        ? { ...base, canChat: true }
        : {
            ...base,
            canChat: false,
            chatDisabledCode: CHAT_DENIAL_COPY[permission.reason].code,
          };
    });
  }

  private async findPairOutcomes(
    userOid: Types.ObjectId,
    partnerIds: Types.ObjectId[],
  ): Promise<Map<string, PairOutcome>> {
    const partnerIsUser1: Types.ObjectId[] = [];
    const partnerIsUser2: Types.ObjectId[] = [];

    for (const partnerId of partnerIds) {
      const [first] = normalisePair(userOid, partnerId);
      if (first.equals(userOid)) partnerIsUser2.push(partnerId);
      else partnerIsUser1.push(partnerId);
    }

    const branches: Record<string, unknown>[] = [];
    if (partnerIsUser2.length) {
      branches.push({ user1: userOid, user2: { $in: partnerIsUser2 } });
    }
    if (partnerIsUser1.length) {
      branches.push({ user1: { $in: partnerIsUser1 }, user2: userOid });
    }

    const outcomes = new Map<string, PairOutcome>();
    if (branches.length === 0) return outcomes;

    const pairs = await this.matchedPairModel
      .find({ $or: branches })
      .select('user1 user2 outcome')
      .lean()
      .exec();

    for (const pair of pairs) {
      const partnerId = pair.user1.equals(userOid) ? pair.user2 : pair.user1;
      outcomes.set(partnerId.toString(), pair.outcome);
    }

    return outcomes;
  }

  async findUserForAuth(
    userId: string,
  ): Promise<{ _id: Types.ObjectId; accountStatus: AccountStatus } | null> {
    return this.userModel
      .findById(userId)
      .select('accountStatus')
      .lean()
      .exec();
  }

  async getOnlineUsers(): Promise<unknown[]> {
    return this.userModel
      .find({ isOnline: true })
      .select('_id fullName picture displayId lastSeen')
      .lean()
      .exec();
  }

  async assertUserExists(userId: string): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('accountStatus')
      .lean()
      .exec();
    if (!user) throw new NotFoundException('Recipient user not found');
  }

  // ── Permission check ──

  async canUsersChat(
    senderId: string,
    receiverId: string,
  ): Promise<ChatPermission> {
    const senderOid = new Types.ObjectId(senderId);
    const receiverOid = new Types.ObjectId(receiverId);

    const [user1, user2] = normalisePair(senderOid, receiverOid);

    const [sender, receiver, pair] = await Promise.all([
      this.userModel.findById(senderOid).select('blockedUsers').lean().exec(),
      this.userModel.findById(receiverOid).select('blockedUsers').lean().exec(),
      this.matchedPairModel
        .findOne({ user1, user2 })
        .select('outcome')
        .lean()
        .exec(),
    ]);

    return decideChatPermission({
      senderExists: !!sender,
      receiverExists: !!receiver,
      senderBlockedReceiver: (sender?.blockedUsers ?? []).some((id) =>
        id.equals(receiverOid),
      ),
      receiverBlockedSender: (receiver?.blockedUsers ?? []).some((id) =>
        id.equals(senderOid),
      ),
      outcome: pair?.outcome,
    });
  }

  private async assertCanChat(
    senderId: string,
    receiverId: string,
  ): Promise<void> {
    const permission = await this.canUsersChat(senderId, receiverId);
    if (permission.allowed) return;

    const copy = CHAT_DENIAL_COPY[permission.reason];
    throw new ForbiddenException({ code: copy.code, message: copy.message });
  }

  // ── Clear chat ──
  async clearChat(requesterId: string, otherId: string): Promise<number> {
    const requesterOid = new Types.ObjectId(requesterId);
    const otherOid = new Types.ObjectId(otherId);

    const result = await this.messageModel.deleteMany({
      $or: [
        { sender: requesterOid, receiver: otherOid },
        { sender: otherOid, receiver: requesterOid },
      ],
    });

    const [user1, user2] = normalisePair(requesterOid, otherOid);
    await this.conversationModel.deleteOne({ participants: [user1, user2] });

    return result.deletedCount;
  }

  // ── Block / Unblock ──
  async blockUser(blockerId: string, targetId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(blockerId, {
      $addToSet: { blockedUsers: new Types.ObjectId(targetId) },
    });
  }

  async unblockUser(blockerId: string, targetId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(blockerId, {
      $pull: { blockedUsers: new Types.ObjectId(targetId) },
    });
  }

  async getBlockedUsers(requesterId: string): Promise<unknown[]> {
    const user = await this.userModel
      .findById(requesterId)
      .select('blockedUsers')
      .lean()
      .exec();

    if (!user || !user.blockedUsers?.length) return [];

    return this.userModel
      .find({ _id: { $in: user.blockedUsers } })
      .select('_id displayId fullName picture')
      .lean()
      .exec();
  }

  // ── Report ──
  async reportUser(
    reporterId: string,
    reportedUserId: string,
    reason: ReportReason,
    details?: string,
  ): Promise<ReportDocument> {
    const report = await this.reportModel.create({
      reporter: new Types.ObjectId(reporterId),
      reportedUser: new Types.ObjectId(reportedUserId),
      reason,
      details,
    });

    await this.blockUser(reporterId, reportedUserId);

    return report;
  }
}
