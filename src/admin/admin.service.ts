import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';

import { User } from 'src/user/schemas/user.schema';
import { MailService } from 'src/auth/mail.service';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { Model } from 'mongoose';

export type StatusAction = 'Approve' | 'Reject';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly mailService: MailService,
  ) {}

  // GET /admin/profile
  async getAdminProfileInfoForUpdate(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('fullName email')
      .lean()
      .exec();
    if (!user) {
      throw new NotFoundException('Admin user not found');
    }
    return {
      fullName: user.fullName,
      email: user.email ?? null,
    };
  }

  // PATCH /admin/profile
  async updateAdminProfileInfo(
    userId: string,
    dto: UpdateAdminProfileDto,
  ): Promise<{
    success: boolean;
    message: string;
    data: Record<string, unknown>;
  }> {
    try {
      // Fetch only the fields we need — minimise document exposure
      const currentUser = await this.userModel
        .findById(userId)
        .select('fullName email password')
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('Admin user not found');
      }

      // Guard: at least one field must be provided
      if (!dto.fullName && !dto.email) {
        throw new BadRequestException(
          'Provide at least one field to update (fullName or email)',
        );
      }

      const update: Partial<User> = {};
      let emailChanged = false;

      if (dto.fullName !== undefined) {
        update.fullName = dto.fullName;
      }

      if (dto.email !== undefined) {
        if (!currentUser.password) {
          throw new BadRequestException(
            'This account has no password set; email cannot be changed here',
          );
        }

        const passwordMatches = await bcrypt.compare(
          dto.currentPassword ?? '',
          currentUser.password,
        );
        if (!passwordMatches) {
          throw new UnauthorizedException('Current password is incorrect');
        }

        if (dto.email !== currentUser.email) {
          const taken = await this.userModel
            .exists({ email: dto.email, _id: { $ne: userId } })
            .exec();
          if (taken) {
            throw new ConflictException('Email is already in use');
          }

          update.email = dto.email;
          emailChanged = true;
        }
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
        message: emailChanged
          ? 'Email updated. Please log in again with your new email.'
          : 'Admin profile updated successfully',
        data: {
          fullName: updated?.fullName ?? null,
          email: updated?.email ?? null,
          requireReLogin: emailChanged,
        },
      };
    } catch (err) {
      const e = err as { status?: number; code?: number };
      if (e.code === 11000) {
        throw new ConflictException('Email is already in use');
      }
      if (e.status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to update admin profile',
      );
    }
  }

  // PATCH /admin/change-password
  async updateAdminPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmNewPassword: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: Record<string, unknown>;
  }> {
    try {
      const currentUser = await this.userModel
        .findById(userId)
        .select('password')
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('Admin user not found');
      }

      if (!currentUser.password) {
        throw new BadRequestException(
          'This account uses social sign-in and has no password to change.',
        );
      }

      if (newPassword !== confirmNewPassword) {
        throw new BadRequestException('Passwords do not match');
      }

      const isCurrentPasswordValid = await bcrypt.compare(
        currentPassword,
        currentUser.password,
      );
      if (!isCurrentPasswordValid) {
        throw new UnauthorizedException('Current password is incorrect');
      }

      const isSamePassword = await bcrypt.compare(
        newPassword,
        currentUser.password,
      );
      if (isSamePassword) {
        throw new BadRequestException(
          'New password must be different from the current password',
        );
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await this.userModel
        .findByIdAndUpdate(userId, { $set: { password: hashedPassword } })
        .exec();

      return {
        success: true,
        message:
          'Password changed. Please log in again with your new password.',
        data: { requireReLogin: true },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to change admin password',
      );
    }
  }
}
