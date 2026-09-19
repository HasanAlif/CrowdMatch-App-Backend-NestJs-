import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BroadcastHistoryDocument = HydratedDocument<BroadcastHistory>;

export enum BroadcastStatus {
  Sending = 'sending',
  Delivered = 'delivered',
  Failed = 'failed',
}

export const BROADCAST_ERROR_MAX_LENGTH = 500;

@Schema({ timestamps: true })
export class BroadcastHistory {
  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({
    type: String,
    enum: BroadcastStatus,
    default: BroadcastStatus.Sending,
    required: true,
  })
  status: BroadcastStatus;

  @Prop({ type: Number, default: 0 })
  usersProcessed: number;

  @Prop({ type: Number, default: 0 })
  recordsCreated: number;

  @Prop({ type: Number, default: 0 })
  pushed: number;

  @Prop({ type: Number, default: 0 })
  failedPages: number;

  @Prop({ type: Number })
  elapsedMs?: number;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: String })
  error?: string;
}

export const BroadcastHistorySchema =
  SchemaFactory.createForClass(BroadcastHistory);

BroadcastHistorySchema.index({ createdAt: -1 });
