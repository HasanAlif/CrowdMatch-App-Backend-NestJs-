import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  WebsiteContent,
  WebsiteContentDocument,
} from './schemas/website-content.schema';
import { ContentType, getContentTypeLabel } from './website-content.types';

@Injectable()
export class WebsiteContentService {
  constructor(
    @InjectModel(WebsiteContent.name)
    private readonly contentModel: Model<WebsiteContentDocument>,
  ) {}

  // PATCH /website-content/:type  — admin upsert
  async createOrUpdateContent(
    type: ContentType,
    content: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: WebsiteContentDocument;
  }> {
    try {
      const label = getContentTypeLabel(type);
      const doc = await this.contentModel
        .findOneAndUpdate(
          { type },
          { $set: { content } },
          { new: true, upsert: true, runValidators: true },
        )
        .exec();

      return {
        success: true,
        message: `${label} updated successfully`,
        data: doc,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to update content',
      );
    }
  }

  // GET /website-content/:type  — public, returns stub when not yet created
  async getContentByType(type: ContentType): Promise<{
    success: boolean;
    message: string;
    data:
      | WebsiteContentDocument
      | {
          _id: null;
          type: ContentType;
          content: string;
          createdAt: Date;
          updatedAt: Date;
        };
  }> {
    try {
      const label = getContentTypeLabel(type);
      const doc = await this.contentModel.findOne({ type }).exec();

      if (!doc) {
        const now = new Date();
        return {
          success: true,
          message: `${label} not yet created`,
          data: {
            _id: null,
            type,
            content: '',
            createdAt: now,
            updatedAt: now,
          },
        };
      }

      return {
        success: true,
        message: `${label} retrieved successfully`,
        data: doc,
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to retrieve content',
      );
    }
  }
}
