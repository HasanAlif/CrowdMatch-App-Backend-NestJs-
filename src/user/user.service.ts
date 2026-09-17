import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User } from './schemas/user.schema';
import { AccountStatus, AuthProvider } from './user.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InitialCompleteProfileDto } from './dto/initial-complete-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import {
  DeleteAccountDto,
  DELETE_CONFIRM_TEXT,
} from './dto/delete-account.dto';
import { ResolvedDevice } from '../auth/dto/device.dto';
import { CloudinaryService } from '../utils/cloudinary/cloudinary.service';
import { Notification } from '../notification/schemas/notification.schema';
import { Match } from '../matching/schemas/match.schema';
import {
  GATE_AGE_PREFERENCE,
  GATE_INTERESTED_IN_GENDERS,
  GATE_MAX_DISTANCE_KM,
  votesUntilPictureUpdate,
} from '../common/vote-thresholds';
import { DELETED_USER_PLACEHOLDER_NAME } from '../common/user-constants';
import { ActivityLog } from '../activity-log/schemas/activity-log.schema';

const GATE_FIELDS =
  'pictureId picture totalVotes currentVotes interestedInGenders ' +
  'minAgePreference maxAgePreference maxDistanceKm pictureUpdateExpiresAt';

const DELETION_UNSET_FIELDS = [
  'email',
  'phoneNumber',
  'googleId',
  'appleId',
  'password',
  'otp',
  'otpExpiry',
  'picture',
  'pictureId',
  'bio',
  'location',
  'address',
  'dateOfBirth',
  'age',
  'gender',
  'lastSeen',
  'interestedInGenders',
  'minAgePreference',
  'maxAgePreference',
  'maxDistanceKm',
  'geoLocation',
  'boostExpiresAt',
  'boostEndsNotifyAt',
  'pictureUpdateExpiresAt',
];

export { DELETED_USER_PLACEHOLDER_NAME };

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
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(ActivityLog.name)
    private readonly activityLogModel: Model<ActivityLog>,
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

  async upsertDevice(userId: string, device: ResolvedDevice) {
    const now = new Date();

    const updated = await this.userModel
      .updateOne(
        { _id: userId, 'devices.deviceId': device.deviceId },
        {
          $set: {
            'devices.$.fcmToken': device.fcmToken,
            'devices.$.platform': device.platform,
            'devices.$.deviceName': device.deviceName,
            'devices.$.lastSeenAt': now,
          },
        },
      )
      .exec();

    if (updated.matchedCount > 0) return;

    await this.userModel
      .updateOne(
        { _id: userId, 'devices.deviceId': { $ne: device.deviceId } },
        {
          $push: {
            devices: {
              fcmToken: device.fcmToken,
              deviceId: device.deviceId,
              platform: device.platform,
              deviceName: device.deviceName,
              lastSeenAt: now,
            },
          },
        },
      )
      .exec();
  }

  async captureDeviceSafely(
    userId: string,
    device: ResolvedDevice | null,
  ): Promise<void> {
    if (!device) return;
    try {
      await this.upsertDevice(userId, device);
    } catch (err) {
      this.logger.error(
        `Device capture failed for user ${userId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async removeDevice(userId: string, deviceId: string): Promise<boolean> {
    const res = await this.userModel
      .updateOne(
        { _id: userId, 'devices.deviceId': deviceId },
        { $pull: { devices: { deviceId } } },
      )
      .exec();
    return res.matchedCount > 0;
  }

  async getDevices(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('devices')
      .lean()
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user.devices ?? [];
  }

  async updateNotificationPreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const update: Record<string, boolean> = {};
    if (dto.isNotifyNewMatches !== undefined) {
      update.isNotifyNewMatches = dto.isNotifyNewMatches;
    }
    if (dto.isNotifyActivityReminders !== undefined) {
      update.isNotifyActivityReminders = dto.isNotifyActivityReminders;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException(
        'Provide at least one of isNotifyNewMatches or isNotifyActivityReminders',
      );
    }

    const user = await this.userModel
      .findOneAndUpdate(
        { _id: userId },
        { $set: update },
        {
          returnDocument: 'after',
          projection: { isNotifyNewMatches: 1, isNotifyActivityReminders: 1 },
        },
      )
      .lean()
      .exec();

    if (!user) throw new NotFoundException('User not found');

    return {
      isNotifyNewMatches: user.isNotifyNewMatches,
      isNotifyActivityReminders: user.isNotifyActivityReminders,
    };
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
      user.interestedInGenders != null,
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
      update.gender = dto.gender;

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
          gender: updated?.gender ?? null,
        },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to complete profile',
      );
    }
  }

  async getProfile(userId: string) {
    return await this.userModel
      .findById(userId)
      .select(
        'picture fullName age interestedInGenders minAgePreference maxAgePreference maxDistanceKm',
      )
      .lean()
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

  // ── Account deletion ──
  async assertAccountActive(userId: string): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('accountStatus')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.accountStatus !== AccountStatus.Active) {
      throw new ForbiddenException('This account is no longer active');
    }
  }

  async deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): Promise<{
    success: boolean;
    message: string;
    data: Record<string, unknown>;
  }> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('password accountStatus pictureId photos')
        .lean()
        .exec();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.accountStatus === AccountStatus.Deleted) {
        throw new GoneException('This account has already been deleted');
      }

      // 1. Confirm intent, before any write
      if (user.password) {
        if (!dto.password) {
          throw new BadRequestException(
            'Your current password is required to delete this account',
          );
        }

        const isPasswordValid = await bcrypt.compare(
          dto.password,
          user.password,
        );

        if (!isPasswordValid) {
          throw new BadRequestException('Current password is incorrect');
        }
      } else if (dto.confirmText !== DELETE_CONFIRM_TEXT) {
        // Social auth — there is no password to verify, so require the phrase.
        throw new BadRequestException(
          `This account uses social sign-in. Send confirmText "${DELETE_CONFIRM_TEXT}" to delete it.`,
        );
      }

      const deletedAt = new Date();

      // 2. Tombstone FIRST — the account is disabled after this line
      const tombstone = await this.updateUserById(
        userId,
        {
          fullName: DELETED_USER_PLACEHOLDER_NAME,
          accountStatus: AccountStatus.Deleted,
          deletedAt,
          isVerified: false,
          photos: [],
          devices: [],
          blockedUsers: [],
          isOnline: false,
          isNotifyNewMatches: false,
          isNotifyActivityReminders: false,
        },
        DELETION_UNSET_FIELDS,
      );

      if (!tombstone) {
        throw new NotFoundException('User not found');
      }

      // 3. Secondary cleanup — each step independently retryable
      await this.purgeNotifications(userId);
      await this.purgeActivityLogs(userId);
      await this.expireActiveMatches(userId);
      await this.destroyStoredImages(user.pictureId, user.photos);

      return {
        success: true,
        message: 'Account deleted successfully',
        data: { deletedAt },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to delete account',
      );
    }
  }

  async checkAccountStatus(userId: string): Promise<{
    success: boolean;
    message: string;
    data: {
      accountStatus: AccountStatus;
      authProvider: AuthProvider;
      isSocialLogin: boolean;
      deleteConfirmation: {
        method: 'password' | 'confirmText';
        confirmText?: string;
      };
    };
  }> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('accountStatus authProvider password')
        .lean()
        .exec();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const hasPassword = Boolean(user.password);

      return {
        success: true,
        message: 'Account status fetched successfully',
        data: {
          accountStatus: user.accountStatus,
          authProvider: user.authProvider,
          isSocialLogin: !hasPassword,
          deleteConfirmation: hasPassword
            ? { method: 'password' }
            : { method: 'confirmText', confirmText: DELETE_CONFIRM_TEXT },
        },
      };
    } catch (err) {
      if ((err as { status?: number }).status) throw err;
      throw new InternalServerErrorException(
        (err as Error).message ?? 'Failed to get account status',
      );
    }
  }

  private async purgeNotifications(userId: string): Promise<void> {
    try {
      await this.notificationModel
        .deleteMany({ recipient: new Types.ObjectId(userId) })
        .exec();
    } catch (err) {
      this.logger.error(
        `Failed to purge notifications for deleted user ${userId}: ` +
          ((err as Error).message ?? 'unknown error'),
      );
    }
  }

  private async purgeActivityLogs(userId: string): Promise<void> {
    try {
      await this.activityLogModel
        .deleteMany({ subject: new Types.ObjectId(userId) })
        .exec();
    } catch (err) {
      this.logger.error(
        `Failed to purge activity logs for deleted user ${userId}: ` +
          ((err as Error).message ?? 'unknown error'),
      );
    }
  }

  async expireActiveMatches(userId: string): Promise<void> {
    const userOid = new Types.ObjectId(userId);
    try {
      await Promise.all([
        this.matchModel
          .updateMany(
            { user1: userOid, isExpired: false },
            { $set: { isExpired: true } },
          )
          .exec(),
        this.matchModel
          .updateMany(
            { user2: userOid, isExpired: false },
            { $set: { isExpired: true } },
          )
          .exec(),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to expire matches for deleted user ${userId}: ` +
          ((err as Error).message ?? 'unknown error'),
      );
    }
  }

  private async destroyStoredImages(
    pictureId?: string,
    photos?: { publicId: string }[],
  ): Promise<void> {
    const publicIds = [
      ...(pictureId ? [pictureId] : []),
      ...(photos ?? []).map((p) => p.publicId).filter(Boolean),
    ];

    for (const publicId of publicIds) {
      try {
        await this.cloudinaryService.deleteImage(publicId);
      } catch (err) {
        this.logger.error(
          `Failed to delete Cloudinary asset ${publicId}: ` +
            ((err as Error).message ?? 'unknown error'),
        );
      }
    }
  }
}
