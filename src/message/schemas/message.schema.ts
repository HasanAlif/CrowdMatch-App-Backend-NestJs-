import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

@Schema({ _id: false })
export class MessageImage {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  publicId: string;
}

export const MessageImageSchema = SchemaFactory.createForClass(MessageImage);

// ── Message ───
@Schema({ timestamps: true })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sender: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  receiver: Types.ObjectId;

  @Prop({ type: String, maxlength: 5000 })
  text?: string;

  @Prop({ type: [MessageImageSchema], default: [] })
  images: MessageImage[];

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date })
  readAt?: Date;

  @Prop({ type: String })
  clientMessageId?: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
MessageSchema.index({ receiver: 1, sender: 1, createdAt: -1 });
MessageSchema.index({ receiver: 1, isRead: 1 });
