import mongoose, { Schema, Document, Types } from 'mongoose';

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

const groupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    emoji: { type: String, default: '👥' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [groupMemberSchema], default: [] },
    inviteCode: { type: String, required: true, unique: true, index: true },
    monthlyBudget: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const Group = mongoose.model<IGroup>('Group', groupSchema);
