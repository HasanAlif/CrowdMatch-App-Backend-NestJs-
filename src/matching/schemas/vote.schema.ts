import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum VoteType {
  Positive = 'positive',
  Negative = 'negative',
}

export type VoteDocument = HydratedDocument<Vote>;

@Schema({ timestamps: true })
export class Vote {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  voter: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Match', required: true, index: true })
  match: Types.ObjectId;

  @Prop({ type: String, enum: VoteType, required: true })
  voteType: VoteType;
}

export const VoteSchema = SchemaFactory.createForClass(Vote);

VoteSchema.index({ voter: 1, match: 1 }, { unique: true });
VoteSchema.index({ voter: 1, createdAt: -1 });
