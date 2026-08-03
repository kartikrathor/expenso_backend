import mongoose, { Schema, Document, Types } from 'mongoose';

export type UserRole = 'user' | 'admin';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  avatarColor: string;
  monthlyBudget: number;
  role: UserRole;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

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
    lastActiveAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>('User', userSchema);
export type UserId = Types.ObjectId;
