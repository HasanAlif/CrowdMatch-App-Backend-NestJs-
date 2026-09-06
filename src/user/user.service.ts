import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InitialCompleteProfileDto } from './dto/initial-complete-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CloudinaryService } from '../utils/cloudinary/cloudinary.service';
import {
  GATE_AGE_PREFERENCE,
  GATE_INTERESTED_IN_GENDERS,
  GATE_MAX_DISTANCE_KM,
  votesUntilPictureUpdate,
} from '../common/vote-thresholds';

const GATE_FIELDS =
  'pictureId picture totalVotes currentVotes interestedInGenders ' +
  'minAgePreference maxAgePreference maxDistanceKm pictureUpdateExpiresAt';

type GateUser = Pick<
  User,
  | 'totalVotes'
  | 'currentVotes'
  | 'interestedInGenders'
  | 'minAgePreference'
  | 'maxAgePreference'
  | 'maxDistanceKm'
  | 'picture'
  | 'pictureId'
  | 'pictureUpdateExpiresAt'
>;

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
    extraFilter?: Record<string, unknown>,
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
      .findOneAndUpdate({ _id: id, ...(extraFilter ?? {}) }, update, {
        returnDocument: 'after',
      })
      .exec();
  }

  // ── VOTE GATES ──
  private assertGate(
    isChanging: boolean,
    isAlreadySet: boolean,
    threshold: number,
    totalVotes: number,
  ): void {
    if (!isChanging || isAlreadySet) return;
    if (totalVotes >= threshold) return;

    throw new ForbiddenException(
      `Requires ${threshold} votes — you have ${totalVotes}`,
    );
  }

  private assertProfileGates(user: GateUser, dto: UpdateProfileDto): void {
    const totalVotes = user.totalVotes ?? 0;

    this.assertGate(
      dto.interestedInGenders !== undefined,
      (user.interestedInGenders?.length ?? 0) > 0,
      GATE_INTERESTED_IN_GENDERS,
      totalVotes,
    );

    this.assertGate(
      dto.minAgePreference !== undefined || dto.maxAgePreference !== undefined,
      user.minAgePreference != null || user.maxAgePreference != null,
      GATE_AGE_PREFERENCE,
      totalVotes,
    );

    this.assertGate(
      dto.maxDistanceKm !== undefined,
      user.maxDistanceKm != null,
      GATE_MAX_DISTANCE_KM,
      totalVotes,
    );
  }

  private assertPictureGate(user: GateUser): boolean {
    if (!user.picture) return false;

    const windowOpen =
      user.pictureUpdateExpiresAt != null &&
      new Date(user.pictureUpdateExpiresAt).getTime() > Date.now();

    if (!windowOpen) {
      const remaining = votesUntilPictureUpdate(user.currentVotes ?? 0);
      throw new ForbiddenException(
        `Please complete ${remaining} more votes to update your profile picture.`,
      );
    }

    return true;
  }

  private async consumeAndUpdate(
    userId: string,
    update: Partial<User>,
    consumesWindow: boolean,
    uploadedPictureId: string | null = null,
  ) {
    if (!consumesWindow) {
      return await this.updateUserById(userId, update);
    }

    const updated = await this.updateUserById(
      userId,
      update,
      ['pictureUpdateExpiresAt'],
      { pictureUpdateExpiresAt: { $gt: new Date() } },
    );

    if (!updated) {
      if (uploadedPictureId) {
        await this.cloudinaryService
          .deleteImage(uploadedPictureId)
          .catch(() => undefined);
      }

      const fresh = await this.userModel
        .findById(userId)
        .select('currentVotes')
        .lean()
        .exec();

      throw new ForbiddenException(
        `Please complete ${votesUntilPictureUpdate(fresh?.currentVotes ?? 0)} ` +
          `more votes to update your profile picture.`,
      );
    }

    return updated;
  }

  async initialCompleteProfile(
    userId: string,
    dto: InitialCompleteProfileDto,
    photoFile?: Express.Multer.File,
  ): Promise<{
    success: boolean;
    message: string;
    data: Record<string, unknown>;
  }> {
    try {
      const currentUser = await this.userModel
        .findById(userId)
        .select(GATE_FIELDS)
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('User not found');
      }

      const update: Partial<User> = {};
      update.fullName = dto.fullName;
      update.age = dto.age;

      const consumesWindow = photoFile
        ? this.assertPictureGate(currentUser)
        : false;

      if (photoFile) {
        if (currentUser.pictureId) {
          await this.cloudinaryService.deleteImage(currentUser.pictureId);
        }

        const { url, publicId } = await this.cloudinaryService.uploadImage(
          photoFile.buffer,
          'profile-pictures',
        );

        update.picture = url;
        update.pictureId = publicId;
      }

      const updated = await this.consumeAndUpdate(
        userId,
        update,
        consumesWindow,
      );

      return {
        success: true,
        message: 'Profile completed successfully',
        data: {
          picture: updated?.picture ?? null,
          fullName: updated?.fullName ?? null,
          age: updated?.age ?? null,
        },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to complete profile',
      );
    }
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
        .select(GATE_FIELDS)
        .lean()
        .exec();

      if (!currentUser) {
        throw new NotFoundException('User not found');
      }

      this.assertProfileGates(currentUser, dto);
      const consumesWindow = pictureFile
        ? this.assertPictureGate(currentUser)
        : false;

      const update: Partial<User> = {};
      if (dto.fullName !== undefined) update.fullName = dto.fullName;
      if (dto.phoneNumber !== undefined) update.phoneNumber = dto.phoneNumber;
      if (dto.address !== undefined) update.address = dto.address;
      if (dto.gender !== undefined) update.gender = dto.gender;
      if (dto.dateOfBirth !== undefined) update.dateOfBirth = dto.dateOfBirth;
      if (dto.bio !== undefined) update.bio = dto.bio;
      if (dto.interestedInGenders !== undefined)
        update.interestedInGenders = dto.interestedInGenders;
      if (dto.minAgePreference !== undefined)
        update.minAgePreference = dto.minAgePreference;
      if (dto.maxAgePreference !== undefined)
        update.maxAgePreference = dto.maxAgePreference;
      if (dto.maxDistanceKm !== undefined)
        update.maxDistanceKm = dto.maxDistanceKm;

      let uploadedPictureId: string | null = null;
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
        uploadedPictureId = publicId;
      }

      const updated = await this.consumeAndUpdate(
        userId,
        update,
        consumesWindow,
        uploadedPictureId,
      );

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
