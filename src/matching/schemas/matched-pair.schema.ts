import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// ── Enum ──
export enum PairOutcome {
  Pending = 'pending',
  Mutual = 'mutual',
  Rejected = 'rejected',
}

export type MatchedPairDocument = HydratedDocument<MatchedPair>;

@Schema({ timestamps: true, collection: 'matched_pairs' })
export class MatchedPair {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user1: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user2: Types.ObjectId;

  @Prop({
    type: String,
    enum: PairOutcome,
    default: PairOutcome.Pending,
    required: true,
  })
  outcome: PairOutcome;

  @Prop({ type: Date, required: true })
  firstMatchedAt: Date;

  @Prop({ type: Date })
  lastMatchedAt: Date;

  @Prop({ type: Date, required: false })
  rejectedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  rejectedBy?: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  matchCount: number;

  @Prop({ type: Number, required: false })
  decisionVersion?: number;
}

export const MatchedPairSchema = SchemaFactory.createForClass(MatchedPair);

MatchedPairSchema.index({ user1: 1, user2: 1 }, { unique: true });
MatchedPairSchema.index({ user1: 1, outcome: 1 });
MatchedPairSchema.index({ user2: 1, outcome: 1 });
