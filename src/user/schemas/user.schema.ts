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

/**
 * One push-capable device belonging to a user.
 *
 * deviceId is the NATURAL KEY: it identifies the physical device and is stable
 * across token rotations. Every capture point UPSERTS by deviceId rather than
 * appending, because FCM tokens rotate constantly — appending would grow the
 * array without bound and fan a single notification out as N duplicate pushes
 * to the same handset.
 */
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

  @Prop({ type: Number, default: 0 })
  totalVotes: number;

  @Prop({ type: Number, default: 0 })
  currentVotes: number;

  @Prop({ type: Date })
  boostExpiresAt?: Date;

  /**
   * PENDING QUEUE for the boost-end announcement — present ONLY while a boost
   * end is owed and unannounced, absent otherwise.
   *
   * This is what makes the every-2-minutes sweep free. The obvious query
   * ("boostExpiresAt <= now AND not yet announced") compares two fields, which
   * needs $expr and cannot use an index; and { boostExpiresAt: 1 } would then
   * be scanned across every user who has EVER been boosted, since all of their
   * expiries are in the past. Here the sparse index below holds only the
   * handful of users with an outstanding announcement, so the (almost always
   * empty) sweep examines zero keys.
   *
   * Written in the same $set branch that grants the boost, so it costs castVote
   * nothing, and $unset the moment the end is announced.
   *
   * NON-STACKING falls out of this for free: re-earning a boost at 100 while
   * the 50-boost is live simply overwrites this with the new expiry, so there
   * is never more than one pending announcement per user and the first boost
   * never separately "ends".
   */
  @Prop({ type: Date })
  boostEndsNotifyAt?: Date;

  /** Audit stamp: when this user's last boost end was actually announced. */
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

/**
 * Serves the boost-end sweep, which runs every 2 minutes (~720x/day) and
 * returns nothing almost every time.
 *
 * sparse: true keeps out every user without a pending announcement, so the
 * B-tree holds only boosts awaiting their end message. The sweep's range is
 * [MinKey, now] and every live entry is > now, so the empty case examines
 * ZERO keys — verified by explain in notification-rewards.int-spec.ts.
 */
UserSchema.index({ boostEndsNotifyAt: 1 }, { sparse: true });

/**
 * Push-target lookups for the two notification crons, which both run exactly
 * "users with >=1 device AND preference X enabled".
 *
 * The partialFilterExpression keeps ONLY users who actually have a device in
 * the index, which is precisely the push-target population — the tokenless
 * tail (web signups that never granted permission, lapsed accounts) never
 * enters the B-tree at all. The trailing _id key gives bounded seeks for the
 * `_id: { $in: [...recipients] }` form the new-match trigger uses, instead of
 * falling back to the _id index and re-checking the preference on every doc.
 *
 * NOTE: a query must include `'devices.0': { $exists: true }` LITERALLY for
 * MongoDB to consider a partial index eligible. NotificationService always
 * emits it — see pushTargetFilter().
 */
UserSchema.index(
  { isNotifyNewMatches: 1, _id: 1 },
  { partialFilterExpression: { 'devices.0': { $exists: true } } },
);

UserSchema.index(
  { isNotifyActivityReminders: 1, _id: 1 },
  { partialFilterExpression: { 'devices.0': { $exists: true } } },
);

// Device lookup by natural key — used by the upsert path and by $pull on logout.
UserSchema.index({ 'devices.deviceId': 1 }, { sparse: true });

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
