import mongoose, { Schema, Document, Types } from 'mongoose';

export type UserRole = 'user' | 'admin';

export interface IThemePurchase {
  packId: string;
  kind: 'monthly' | 'permanent';
  purchasedAt: Date;
  expiresAt: Date | null;
}

export interface IUserDevice {
  deviceId: string;
  platform: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  avatarColor: string;
  monthlyBudget: number;
  role: UserRole;
  /** FCM device tokens for push notifications */
  fcmTokens: string[];
  /** Stable app install IDs seen for this account */
  devices: IUserDevice[];
  /** When I add a joint expense, notify my partner */
  notifyPartnerOnMyJointAdd: boolean;
  /** When partner adds a joint expense, notify me */
  notifyMeOnPartnerJointAdd: boolean;
  lastActiveAt: Date;
  /** Last successful password login */
  lastLoginAt: Date | null;
  lastLoginDeviceId: string;
  /** Temp password from support — must change after login */
  mustChangePassword: boolean;
  /** Pro subscription */
  proPlan: 'monthly' | 'yearly' | null;
  proStatus: 'none' | 'active' | 'expired' | 'cancelled';
  proExpiresAt: Date | null;
  proDailyTokensOverride: number | null;
  proProvider: string;
  themePurchases: IThemePurchase[];
  createdAt: Date;
  updatedAt: Date;
}

const themePurchaseSchema = new Schema<IThemePurchase>(
  {
    packId: { type: String, required: true },
    kind: { type: String, enum: ['monthly', 'permanent'], required: true },
    purchasedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { _id: false },
);

const userDeviceSchema = new Schema<IUserDevice>(
  {
    deviceId: { type: String, required: true, trim: true, maxlength: 128 },
    platform: { type: String, default: 'unknown', maxlength: 40 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    avatarColor: { type: String, default: '#6366F1' },
    monthlyBudget: { type: Number, default: 0, min: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    fcmTokens: { type: [String], default: [] },
    devices: { type: [userDeviceSchema], default: [] },
    notifyPartnerOnMyJointAdd: { type: Boolean, default: true },
    notifyMeOnPartnerJointAdd: { type: Boolean, default: true },
    lastActiveAt: { type: Date, default: Date.now, index: true },
    lastLoginAt: { type: Date, default: null },
    lastLoginDeviceId: { type: String, default: '' },
    mustChangePassword: { type: Boolean, default: false },
    proPlan: {
      type: String,
      enum: ['monthly', 'yearly', null],
      default: null,
    },
    proStatus: {
      type: String,
      enum: ['none', 'active', 'expired', 'cancelled'],
      default: 'none',
    },
    proExpiresAt: { type: Date, default: null },
    proDailyTokensOverride: { type: Number, default: null },
    proProvider: { type: String, default: '' },
    themePurchases: { type: [themePurchaseSchema], default: [] },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>('User', userSchema);
export type UserId = Types.ObjectId;
