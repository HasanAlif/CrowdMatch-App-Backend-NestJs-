import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ContentType } from '../website-content.types';

export type WebsiteContentDocument = HydratedDocument<WebsiteContent>;

@Schema({ timestamps: true })
export class WebsiteContent {
  @Prop({
    type: String,
    enum: Object.values(ContentType),
    required: true,
    unique: true,
  })
  type: ContentType;

  @Prop({ type: String, required: true, trim: true })
  content: string;
}

export const WebsiteContentSchema =
  SchemaFactory.createForClass(WebsiteContent);
