import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CloudinaryService } from '../utils/cloudinary/cloudinary.service';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async createUser(data: Partial<User>) {
    try {
      return await this.userModel.create(data);
    } catch (error) {
      const e = error as { code?: number; message?: string };
      if (e.code === 11000) {
        throw new ConflictException(
          'User already exists with these credentials',
        );
      }
      throw new InternalServerErrorException(
        e.message ?? 'Failed to create user',
      );
    }
  }

  async findByEmail(email: string) {
    return await this.userModel.findOne({ email }).lean().exec();
  }

  async findByPhone(phoneNumber: string) {
    return await this.userModel.findOne({ phoneNumber }).lean().exec();
  }

  async findByGoogleId(googleId: string) {
    return await this.userModel.findOne({ googleId }).lean().exec();
  }

  async findByAppleId(appleId: string) {
    return await this.userModel.findOne({ appleId }).lean().exec();
  }

  async getUserById(id: string) {
    return await this.userModel.findOne({ _id: id }).lean().exec();
  }

  async updateUserById(
    id: string,
    data: Partial<User>,
    unsetFields?: string[],
  ) {
    const update: Record<string, unknown> = { $set: data };
    if (unsetFields && unsetFields.length > 0) {
      const unset: Record<string, number> = {};
      for (const field of unsetFields) {
        unset[field] = 1;
      }
      update.$unset = unset;
    }
    return await this.userModel
      .findByIdAndUpdate(id, update, { returnDocument: 'after' })
      .exec();
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    pictureFile?: Express.Multer.File,
  ): Promise<{
    success: boolean;
    message: string;
    data: Record<string, unknown>;
  }> {
    try {
      const currentUser = await this.userModel
        .findById(userId)
        .select('pictureId')
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('User not found');
      }

      const update: Partial<User> = {};
      if (dto.fullName !== undefined) update.fullName = dto.fullName;
      if (dto.phoneNumber !== undefined) update.phoneNumber = dto.phoneNumber;
      if (dto.address !== undefined) update.address = dto.address;

      if (pictureFile) {
        const { url, publicId } = await this.cloudinaryService.uploadImage(
          pictureFile.buffer,
          'profile-pictures',
        );

        if (currentUser.pictureId) {
          await this.cloudinaryService.deleteImage(currentUser.pictureId);
        }
        update.picture = url;
        update.pictureId = publicId;
      }
      const updated = await this.updateUserById(userId, update);

      return {
        success: true,
        message: 'Profile updated successfully',
        data: {
          picture: updated?.picture ?? null,
          fullName: updated?.fullName ?? null,
          phoneNumber: updated?.phoneNumber ?? null,
          address: updated?.address ?? null,
        },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to update profile',
      );
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const currentUser = await this.userModel
        .findById(userId)
        .select('password')
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('User not found');
      }

      if (!currentUser.password) {
        throw new BadRequestException(
          'This account uses social sign-in and has no password to change.',
        );
      }

      const isOldPasswordValid = await bcrypt.compare(
        dto.oldPassword,
        currentUser.password,
      );

      if (!isOldPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      const isSamePassword = await bcrypt.compare(
        dto.newPassword,
        currentUser.password,
      );

      if (isSamePassword) {
        throw new BadRequestException(
          'New password must be different from the current password',
        );
      }

      const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

      await this.userModel
        .findByIdAndUpdate(userId, { $set: { password: hashedPassword } })
        .exec();

      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to change password',
      );
    }
  }
}
