import mongoose, { Schema, Document, Types } from 'mongoose';
import { MONTH_KEY_PATTERN, MonthlyBudgetEntry } from '../services/monthlyBudgets';

export type GroupRole = 'owner' | 'member';

export interface IGroupMember {
  user: Types.ObjectId;
  role: GroupRole;
  joinedAt: Date;
}

export interface IGroup extends Document {
  name: string;
  emoji: string;
  createdBy: Types.ObjectId;
  members: IGroupMember[];
  inviteCode: string;
  monthlyBudget: number;
  monthlyBudgets: MonthlyBudgetEntry[];
  repeatMonthlyBudget: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const groupMemberSchema = new Schema<IGroupMember>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const monthlyBudgetSchema = new Schema<MonthlyBudgetEntry>(
  {
    month: { type: String, required: true, match: MONTH_KEY_PATTERN },
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isFinite,
    },
  },
  { _id: false },
);

const groupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    emoji: { type: String, default: '👥' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [groupMemberSchema], default: [] },
    inviteCode: { type: String, required: true, unique: true, index: true },
    monthlyBudget: { type: Number, default: 0, min: 0, validate: Number.isFinite },
    monthlyBudgets: { type: [monthlyBudgetSchema], default: [] },
    repeatMonthlyBudget: { type: Boolean, default: false },
  },
  { timestamps: true },
);

groupSchema.index({ 'members.user': 1 });

export const Group = mongoose.model<IGroup>('Group', groupSchema);
