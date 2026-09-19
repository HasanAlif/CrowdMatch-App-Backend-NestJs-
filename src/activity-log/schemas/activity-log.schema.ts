import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum ActivityType {
  UserJoined = 'user_joined',
  MatchCreated = 'match_created',
  UserBlocked = 'user_blocked',
  MatchRemoved = 'match_removed',
  BroadcastSent = 'broadcast_sent',
  Milestone = 'milestone',
}

export const ACTIVITY_LOG_TTL_SECONDS = 48 * 60 * 60;

export type ActivityLogDocument = HydratedDocument<ActivityLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ActivityLog {
  @Prop({ type: String, enum: ActivityType, required: true })
  type: ActivityType;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  subject?: Types.ObjectId;

  createdAt: Date;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);

ActivityLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ACTIVITY_LOG_TTL_SECONDS },
);

ActivityLogSchema.index({ subject: 1 }, { sparse: true });
