import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Report, ReportDocument } from './schemas/report.schema';
import { ReportReason } from './schemas/report.schema';
import { User } from '../user/schemas/user.schema';
import { AccountStatus } from '../user/user.types';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
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
    return this.messageModel.create({
      sender: new Types.ObjectId(data.senderId),
      receiver: new Types.ObjectId(data.receiverId),
      text: data.text,
      images: data.images ?? [],
      clientMessageId: data.clientMessageId,
    });
  }

  // ── Mark read ──
  async markRead(viewerId: string, senderId: string): Promise<number> {
    const result = await this.messageModel.updateMany(
      {
        sender: new Types.ObjectId(senderId),
        receiver: new Types.ObjectId(viewerId),
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } },
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

  /**
    Returns the list of distinct conversation partners for `userId`, ordered
    by the most recent message timestamp descending.  Each entry includes a
    last-message preview, the partner's basic profile, and the unread count
    for that conversation.
   
    Algorithm of this flow:
     1. $match — all messages where userId is sender OR receiver.
     2. $sort  — newest first before grouping (MongoDB preserves order inside
                 $push for the accumulator used below).
     3. $group — by "other party" ID; accumulate last message + unread count.
     4. $lookup — hydrate the other party's profile (name, picture).
     5. $sort  — final sort by lastMessage.createdAt descending.
   */
  async getConversations(userId: string): Promise<unknown[]> {
    const userOid = new Types.ObjectId(userId);

    const pipeline: PipelineStage[] = [
      // 1. Scope to this user's messages.
      {
        $match: {
          $or: [{ sender: userOid }, { receiver: userOid }],
        },
      },

      // 2. Newest-first so $first/$push give us the most-recent message.
      { $sort: { createdAt: -1 } },

      // 3. Group by conversation partner.
      {
        $group: {
          _id: {
            $cond: [{ $eq: ['$sender', userOid] }, '$receiver', '$sender'],
          },
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiver', userOid] },
                    { $eq: ['$isRead', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },

      // 4. Join partner's profile.
      {
        $lookup: {
          from: 'users',
          localField: '_id',
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
              },
            },
          ] as Exclude<
            PipelineStage,
            PipelineStage.Merge | PipelineStage.Out
          >[],
        },
      },
      { $unwind: '$partner' },

      // 5. Final sort by most-recent message.
      { $sort: { 'lastMessage.createdAt': -1 } },

      // 6. Project to a clean shape.
      {
        $project: {
          _id: 0,
          partner: 1,
          lastMessage: {
            _id: '$lastMessage._id',
            text: '$lastMessage.text',
            images: '$lastMessage.images',
            isRead: '$lastMessage.isRead',
            createdAt: '$lastMessage.createdAt',
            sender: '$lastMessage.sender',
          },
          unreadCount: 1,
        },
      },
    ];

    try {
      return this.messageModel.aggregate(pipeline).exec();
    } catch (err) {
      this.logger.error('getConversations aggregation failed', err);
      throw new InternalServerErrorException('Failed to load conversations');
    }
  }

  // ── Helpers ──
  // Load a minimal user record needed for socket auth (accountStatus only).
  // Returns null if not found.
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
  async canUsersChat(senderId: string, receiverId: string): Promise<boolean> {
    const senderOid = new Types.ObjectId(senderId);
    const receiverOid = new Types.ObjectId(receiverId);

    const [sender, receiver] = await Promise.all([
      this.userModel.findById(senderOid).select('blockedUsers').lean().exec(),
      this.userModel.findById(receiverOid).select('blockedUsers').lean().exec(),
    ]);

    if (!sender || !receiver) return false;

    const senderBlockedReceiver = (sender.blockedUsers ?? []).some((id) =>
      id.equals(receiverOid),
    );
    const receiverBlockedSender = (receiver.blockedUsers ?? []).some((id) =>
      id.equals(senderOid),
    );

    if (senderBlockedReceiver || receiverBlockedSender) return false;
    return true;
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
