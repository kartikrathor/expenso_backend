import mongoose, { Schema, Document, Types } from 'mongoose';

export type TicketCategory = 'bug' | 'account' | 'billing' | 'feature' | 'other';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface ITicketReply {
  role: 'user' | 'admin';
  message: string;
  authorName: string;
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  user: Types.ObjectId;
  subject: string;
  body: string;
  category: TicketCategory;
  status: TicketStatus;
  platform: string;
  adminNote: string;
  replies: ITicketReply[];
  /** Admin has not opened / marked since last user message */
  unreadByAdmin: boolean;
  /** User has not opened since last admin reply */
  unreadByUser: boolean;
  lastMessageAt: Date;
  lastMessageRole: 'user' | 'admin';
  lastMessagePreview: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const replySchema = new Schema<ITicketReply>(
  {
    role: { type: String, enum: ['user', 'admin'], required: true },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    authorName: { type: String, default: '', maxlength: 80 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    category: {
      type: String,
      enum: ['bug', 'account', 'billing', 'feature', 'other'],
      default: 'other',
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    platform: { type: String, default: '', maxlength: 40 },
    adminNote: { type: String, default: '', maxlength: 2000 },
    replies: { type: [replySchema], default: [] },
    unreadByAdmin: { type: Boolean, default: true, index: true },
    unreadByUser: { type: Boolean, default: false, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessageRole: { type: String, enum: ['user', 'admin'], default: 'user' },
    lastMessagePreview: { type: String, default: '', maxlength: 160 },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ user: 1, createdAt: -1 });
supportTicketSchema.index({ unreadByAdmin: 1, lastMessageAt: -1 });

export const SupportTicket = mongoose.model<ISupportTicket>(
  'SupportTicket',
  supportTicketSchema,
);
