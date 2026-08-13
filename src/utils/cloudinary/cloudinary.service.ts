import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  uploadImage(
    fileBuffer: Buffer,
    folder = 'profile-pictures',
  ): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, result) => {
          if (error || !result) {
            const reason = error
              ? new Error(error.message ?? 'Cloudinary upload failed')
              : new Error('Cloudinary upload returned no result');
            return reject(reason);
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );

      const readable = Readable.from(fileBuffer);
      readable.pipe(uploadStream);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      this.logger.warn(
        `Failed to delete Cloudinary asset "${publicId}": ${(err as Error).message}`,
      );
    }
  }
}
