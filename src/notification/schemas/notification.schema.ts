import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  NewMatch = 'new_match',
  MatchAccepted = 'match_accepted',
  ActivityReminder = 'activity_reminder',
  AdminBroadcast = 'admin_broadcast',
  VoteMilestone = 'vote_milestone',
  BoostEnded = 'boost_ended',
}

export const NOTIFICATION_RETENTION_DAYS = 90;
export const NOTIFICATION_TTL_SECONDS =
  NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipient: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type: NotificationType;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date })
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipient: 1, createdAt: -1 });

NotificationSchema.index({ recipient: 1, isRead: 1 });

NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_TTL_SECONDS },
);
