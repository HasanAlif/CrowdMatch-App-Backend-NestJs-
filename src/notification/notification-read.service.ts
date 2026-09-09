import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Notification } from './schemas/notification.schema';

@Injectable()
export class NotificationReadService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  async list(userId: string, page: number, limit: number) {
    const recipient = new Types.ObjectId(userId);
    const skip = (page - 1) * limit;

    const [total, notifications] = await Promise.all([
      this.notificationModel.countDocuments({ recipient }).exec(),
      this.notificationModel
        .find({ recipient })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    return {
      notifications: notifications.map((n: any) => ({
        id: n._id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data ?? {},
        isRead: n.isRead,
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        recipient: new Types.ObjectId(userId),
        isRead: false,
      })
      .exec();
  }

  async getOneAndMarkRead(userId: string, notificationId: string) {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new NotFoundException('Notification not found');
    }

    const recipient = new Types.ObjectId(userId);

    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(notificationId), recipient },
        { $set: { isRead: true, readAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();

    if (!updated) {
      const exists = await this.notificationModel
        .exists({ _id: new Types.ObjectId(notificationId) })
        .exec();
      if (exists) {
        throw new ForbiddenException('This notification is not yours');
      }
      throw new NotFoundException('Notification not found');
    }

    const n = updated as any;
    return {
      id: n._id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data ?? {},
      isRead: n.isRead,
      readAt: n.readAt ?? null,
      createdAt: n.createdAt,
    };
  }

  async markRead(userId: string, notificationId: string) {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new NotFoundException('Notification not found');
    }

    const _id = new Types.ObjectId(notificationId);
    const recipient = new Types.ObjectId(userId);

    const res = await this.notificationModel
      .updateOne(
        { _id, recipient, isRead: false },
        { $set: { isRead: true, readAt: new Date() } },
      )
      .exec();

    if (res.matchedCount === 0) {
      const own = await this.notificationModel
        .findOne({ _id, recipient })
        .select({ _id: 1 })
        .lean()
        .exec();

      if (!own) {
        const exists = await this.notificationModel.exists({ _id }).exec();
        if (exists)
          throw new ForbiddenException('This notification is not yours');
        throw new NotFoundException('Notification not found');
      }
    }

    return { id: notificationId, isRead: true };
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.notificationModel
      .updateMany(
        { recipient: new Types.ObjectId(userId), isRead: false },
        { $set: { isRead: true, readAt: new Date() } },
      )
      .exec();

    return res.modifiedCount ?? 0;
  }
}
