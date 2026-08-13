import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { User } from 'src/user/schemas/user.schema';
import { MailService } from 'src/auth/mail.service';
import { CloudinaryService } from 'src/utils/cloudinary/cloudinary.service';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { Model } from 'mongoose';

export type StatusAction = 'Approve' | 'Reject';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly mailService: MailService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // GET /admin/profile
  async getAdminProfileInfoForUpdate(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('pictureId picture fullName')
      .lean()
      .exec();
    if (!user) {
      throw new NotFoundException('Admin user not found');
    }
    return {
      fullName: user.fullName,
      picture: user.picture,
    };
  }

  // PATCH /admin/profile
  async updateAdminProfileInfo(
    userId: string,
    dto: UpdateAdminProfileDto,
    pictureFile?: Express.Multer.File,
  ): Promise<{
    success: boolean;
    message: string;
    data: Record<string, unknown>;
  }> {
    try {
      // Fetch only the fields we need — minimise document exposure
      const currentUser = await this.userModel
        .findById(userId)
        .select('pictureId picture fullName')
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('Admin user not found');
      }

      // Guard: at least one field must be provided
      if (!dto.fullName && !pictureFile) {
        throw new BadRequestException(
          'Provide at least one field to update (fullName or picture)',
        );
      }

      const update: Partial<User> = {};

      if (dto.fullName !== undefined) {
        update.fullName = dto.fullName;
      }

      if (pictureFile) {
        // Upload new image first
        const { url, publicId } = await this.cloudinaryService.uploadImage(
          pictureFile.buffer,
          'admin-profile-pictures',
        );

        // Delete old image after successful upload to avoid orphaned assets
        if (currentUser.pictureId) {
          await this.cloudinaryService.deleteImage(currentUser.pictureId);
        }

        update.picture = url;
        update.pictureId = publicId;
      }

      const updated = await this.userModel
        .findByIdAndUpdate(
          userId,
          { $set: update },
          { returnDocument: 'after' },
        )
        .exec();

      return {
        success: true,
        message: 'Admin profile updated successfully',
        data: {
          fullName: updated?.fullName ?? null,
          picture: updated?.picture ?? null,
        },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to update admin profile',
      );
    }
  }
}
