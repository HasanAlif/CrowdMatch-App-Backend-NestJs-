import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  Role,
  AuthProvider,
  Gender,
  AccountStatus,
  DevicePlatform,
} from '../user.types';

export type UserDocument = HydratedDocument<User>;
@Schema({ _id: false })
export class UserPhoto {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  publicId: string;

  @Prop({ required: true, type: Number })
  order: number;
}

export const UserPhotoSchema = SchemaFactory.createForClass(UserPhoto);

@Schema({ _id: false })
export class GeoLocation {
  @Prop({ type: String, enum: ['Point'], required: true, default: 'Point' })
  type: string;

  @Prop({ type: [Number], required: true })
  coordinates: number[];
}

export const GeoLocationSchema = SchemaFactory.createForClass(GeoLocation);

@Schema({ _id: false })
export class UserDevice {
  @Prop({ required: true })
  fcmToken: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ type: String, enum: DevicePlatform, required: true })
  platform: DevicePlatform;

  @Prop()
  deviceName?: string;

  @Prop({ type: Date, default: Date.now })
  lastSeenAt: Date;
}

export const UserDeviceSchema = SchemaFactory.createForClass(UserDevice);

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  fullName: string;

  @Prop({ unique: true, sparse: true })
  email?: string;

  @Prop()
  password?: string;

  @Prop({ type: String, enum: Role, default: Role.User })
  role: Role;

  @Prop({ type: String, enum: AuthProvider, default: AuthProvider.Local })
  authProvider: AuthProvider;

  @Prop({ index: true, sparse: true })
  googleId?: string;

  @Prop({ index: true, sparse: true })
  appleId?: string;

  @Prop()
  otp?: string;

  @Prop()
  otpExpiry?: Date;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  location?: string;

  @Prop({ index: true, sparse: true })
  phoneNumber?: string;

  @Prop()
  picture?: string;

  @Prop()
  pictureId?: string;

  @Prop()
  address?: string;

  @Prop({ type: [UserDeviceSchema], default: [] })
  devices: UserDevice[];

  @Prop({ type: Boolean, default: true })
  isNotifyNewMatches: boolean;

  @Prop({ type: Boolean, default: true })
  isNotifyActivityReminders: boolean;

  @Prop({ type: String, enum: Gender })
  gender?: Gender;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop({ type: Number })
  age?: number;

  @Prop({ type: String, maxlength: 500 })
  bio?: string;

  @Prop({ type: [UserPhotoSchema], default: [] })
  photos: UserPhoto[];

  @Prop({ type: String, enum: Gender })
  interestedInGenders?: Gender;

  @Prop({ type: Number })
  minAgePreference: number;

  @Prop({ type: Number })
  maxAgePreference: number;

  @Prop({ type: Number })
  maxDistanceKm: number;

  @Prop({ type: GeoLocationSchema })
  geoLocation?: GeoLocation;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.Active })
  accountStatus: AccountStatus;

  @Prop({ type: Date })
  deletedAt?: Date;

  @Prop({ type: Number, default: 0 })
  totalVotes: number;

  @Prop({ type: Number, default: 0 })
  currentVotes: number;

  @Prop({ type: Date })
  boostExpiresAt?: Date;

  @Prop({ type: Date })
  boostEndsNotifyAt?: Date;

  @Prop({ type: Date })
  boostEndNotifiedAt?: Date;

  @Prop({ type: Date })
  pictureUpdateExpiresAt?: Date;

  @Prop({ type: Number, default: 0 })
  matchCount: number;

  @Prop({ type: Number, default: 0 })
  withCrowdScore: number;

  @Prop({ type: String, unique: true, sparse: true })
  displayId?: string;

  @Prop({ type: Boolean, default: false })
  isOnline: boolean;

  @Prop({ type: Date })
  lastSeen?: Date;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  blockedUsers: Types.ObjectId[];
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ geoLocation: '2dsphere' }, { sparse: true });

UserSchema.index({ accountStatus: 1 });

UserSchema.index({ gender: 1 }, { sparse: true });

UserSchema.index({ interestedInGenders: 1 }, { sparse: true });

UserSchema.index({ isOnline: 1 });

UserSchema.index({ boostExpiresAt: 1 }, { sparse: true });

UserSchema.index({ boostEndsNotifyAt: 1 }, { sparse: true });

UserSchema.index(
  { isNotifyNewMatches: 1, _id: 1 },
  { partialFilterExpression: { 'devices.0': { $exists: true } } },
);

UserSchema.index(
  { isNotifyActivityReminders: 1, _id: 1 },
  { partialFilterExpression: { 'devices.0': { $exists: true } } },
);

UserSchema.index({ 'devices.deviceId': 1 }, { sparse: true });

UserSchema.index({ createdAt: 1, accountStatus: 1 });

UserSchema.pre<UserDocument>('save', async function () {
  if (!this.displayId) {
    const CounterModel = this.db.model('Counter') as any;
    const counter = (await CounterModel.findOneAndUpdate(
      { _id: 'user' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    )) as { seq: number };
    this.displayId = `USR-${String(counter.seq).padStart(3, '0')}`;
  }

  this.isActive = this.accountStatus === AccountStatus.Active;
});

UserSchema.pre('findOneAndUpdate', function () {
  const update = this.getUpdate() as Record<string, unknown> | null;
  if (update) {
    const set = (update.$set ?? {}) as Record<string, unknown>;
    if (set.accountStatus !== undefined) {
      set.isActive = set.accountStatus === AccountStatus.Active;
      update.$set = set;
    } else if (update.accountStatus !== undefined) {
      update.isActive = update.accountStatus === AccountStatus.Active;
    }
  }
});
