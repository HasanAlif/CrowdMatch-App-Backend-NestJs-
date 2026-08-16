import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReportDocument = HydratedDocument<Report>;

export enum ReportReason {
  Harassment = 'harassment',
  FakeProfile = 'fake_profile',
  InappropriateContent = 'inappropriate_content',
  Spam = 'spam',
  Other = 'other',
}

@Schema({ timestamps: true })
export class Report {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  reporter: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  reportedUser: Types.ObjectId;

  @Prop({ type: String, enum: ReportReason, required: true })
  reason: ReportReason;

  @Prop({ type: String, maxlength: 2000 })
  details?: string;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

ReportSchema.index({ reportedUser: 1, createdAt: -1 });
