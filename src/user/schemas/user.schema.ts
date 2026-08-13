import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role, AuthProvider, Gender, AccountStatus } from '../user.types';

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

  @Prop({ type: [String], default: [] })
  fcmTokens: string[];

  @Prop({ type: String, enum: Gender })
  gender?: Gender;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop({ type: String, maxlength: 500 })
  bio?: string;

  @Prop({ type: [UserPhotoSchema], default: [] })
  photos: UserPhoto[];

  @Prop({ type: [String] })
  interestedInGenders?: string[];

  @Prop({ type: Number, default: 18 })
  minAgePreference: number;

  @Prop({ type: Number, default: 99 })
  maxAgePreference: number;

  @Prop({ type: Number, default: 50 })
  maxDistanceKm: number;

  @Prop({ type: GeoLocationSchema })
  geoLocation?: GeoLocation;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.Active })
  accountStatus: AccountStatus;

  @Prop({ type: Number, default: 0 })
  voteCount: number;

  @Prop({ type: Number, default: 0 })
  matchCount: number;

  @Prop({ type: Number, default: 0 })
  withCrowdScore: number;

  @Prop({ type: String, unique: true, sparse: true })
  displayId?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ geoLocation: '2dsphere' }, { sparse: true });

UserSchema.index({ accountStatus: 1 });

UserSchema.index({ gender: 1 }, { sparse: true });

UserSchema.index({ interestedInGenders: 1 }, { sparse: true });

UserSchema.pre<UserDocument>('save', async function () {
  if (!this.displayId) {
    const CounterModel = this.db.model('Counter') as any;
    const counter = (await CounterModel.findOneAndUpdate(
      { _id: 'user' },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
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
