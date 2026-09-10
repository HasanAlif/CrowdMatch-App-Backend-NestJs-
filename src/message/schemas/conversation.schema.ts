import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { MessageImage, MessageImageSchema } from './message.schema';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ _id: false })
export class LastMessageSnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  messageId: Types.ObjectId;

  @Prop({ type: String })
  text?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ type: [MessageImageSchema], default: [] })
  images: MessageImage[];

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date, required: true })
  createdAt: Date;
}

export const LastMessageSnapshotSchema =
  SchemaFactory.createForClass(LastMessageSnapshot);

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  participants: Types.ObjectId[];

  @Prop({ type: Date, required: true })
  lastMessageAt: Date;

  @Prop({ type: LastMessageSnapshotSchema, required: false })
  lastMessage?: LastMessageSnapshot;

  @Prop({ type: Number, default: 0 })
  unreadForUser1: number;

  @Prop({ type: Number, default: 0 })
  unreadForUser2: number;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

ConversationSchema.index(
  { 'participants.0': 1, 'participants.1': 1 },
  { unique: true },
);
