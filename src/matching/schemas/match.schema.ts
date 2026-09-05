import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum MatchDecision {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
}

export enum MatchStatus {
  Pending = 'pending',
  Mutual = 'mutual',
  Rejected = 'rejected',
}

export type MatchDocument = HydratedDocument<Match>;

@Schema({ timestamps: true })
export class Match {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user1: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user2: Types.ObjectId;

  @Prop({
    type: String,
    enum: MatchDecision,
    default: MatchDecision.Pending,
  })
  user1Decision: MatchDecision;

  @Prop({
    type: String,
    enum: MatchDecision,
    default: MatchDecision.Pending,
  })
  user2Decision: MatchDecision;

  @Prop({
    type: String,
    enum: MatchStatus,
    default: MatchStatus.Pending,
  })
  matchStatus: MatchStatus;

  @Prop({ type: Number, default: 0 })
  totalVoteCount: number;

  @Prop({ type: Number, default: 0 })
  positiveVoteCount: number;

  @Prop({ type: Number, default: 0 })
  negativeVoteCount: number;

  @Prop({ type: Boolean, default: false })
  isExpired: boolean;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Number, default: 0 })
  decisionVersion: number;
}

export const MatchSchema = SchemaFactory.createForClass(Match);

MatchSchema.index({ user1: 1, isExpired: 1, createdAt: -1 });
MatchSchema.index({ user2: 1, isExpired: 1, createdAt: -1 });
MatchSchema.index({ isExpired: 1, createdAt: -1 });

MatchSchema.index(
  { user1: 1, user2: 1 },
  {
    unique: true,
    partialFilterExpression: { isExpired: false },
  },
);
