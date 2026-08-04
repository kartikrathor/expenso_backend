import mongoose, { Schema, Document, Types } from 'mongoose';

export type PasswordResetStatus =
  | 'pending'
  | 'awaiting_verification'
  | 'verified'
  | 'temp_password_sent'
  | 'completed'
  | 'rejected';

export interface IPasswordResetMessage {
  role: 'user' | 'admin' | 'system';
  message: string;
  createdAt: Date;
}

export interface IPasswordResetRequest extends Document {
  email: string;
  user: Types.ObjectId;
  deviceId: string;
  platform: string;
  sameDevice: boolean;
  status: PasswordResetStatus;
  /** Snapshot at request time for admin */
  lastLoginAtAtRequest: Date | null;
  lastLoginDeviceIdAtRequest: string;
  otpHash: string;
  otpExpiresAt: Date | null;
  verificationTokenHash: string;
  verificationExpiresAt: Date | null;
  messages: IPasswordResetMessage[];
  adminNote: string;
  tempPasswordSentAt: Date | null;
  verifiedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IPasswordResetMessage>(
  {
    role: { type: String, enum: ['user', 'admin', 'system'], required: true },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const passwordResetSchema = new Schema<IPasswordResetRequest>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, trim: true, maxlength: 128 },
    platform: { type: String, default: '', maxlength: 40 },
    sameDevice: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: [
        'pending',
        'awaiting_verification',
        'verified',
        'temp_password_sent',
        'completed',
        'rejected',
      ],
      default: 'pending',
      index: true,
    },
    lastLoginAtAtRequest: { type: Date, default: null },
    lastLoginDeviceIdAtRequest: { type: String, default: '' },
    otpHash: { type: String, default: '' },
    otpExpiresAt: { type: Date, default: null },
    verificationTokenHash: { type: String, default: '' },
    verificationExpiresAt: { type: Date, default: null },
    messages: { type: [messageSchema], default: [] },
    adminNote: { type: String, default: '', maxlength: 2000 },
    tempPasswordSentAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

passwordResetSchema.index({ status: 1, createdAt: -1 });
passwordResetSchema.index({ user: 1, createdAt: -1 });
passwordResetSchema.index({ deviceId: 1, createdAt: -1 });

export const PasswordResetRequest = mongoose.model<IPasswordResetRequest>(
  'PasswordResetRequest',
  passwordResetSchema,
);
