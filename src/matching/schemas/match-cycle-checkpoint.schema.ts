import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MatchCycleCheckpointDocument =
  HydratedDocument<MatchCycleCheckpoint>;

@Schema({ timestamps: false })
export class MatchCycleCheckpoint {
  @Prop({ type: String, default: 'singleton' })
  _id: string;

  @Prop({ type: Date, required: true })
  lastCycleRunAt: Date;

  @Prop({ type: Date, required: false })
  pairHistoryBackfilledAt?: Date;
}

export const MatchCycleCheckpointSchema =
  SchemaFactory.createForClass(MatchCycleCheckpoint);
