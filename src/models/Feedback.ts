import mongoose, { Schema, Document, Types } from 'mongoose';

export type FeedbackCategory = 'bug' | 'idea' | 'praise' | 'other';
export type FeedbackStatus = 'new' | 'reviewed' | 'archived';

export interface IFeedback extends Document {
  user: Types.ObjectId;
  message: string;
  category: FeedbackCategory;
  platform: string;
  status: FeedbackStatus;
  adminNote: string;
  createdAt: Date;
  updatedAt: Date;
}

const feedbackSchema = new Schema<IFeedback>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    category: {
      type: String,
      enum: ['bug', 'idea', 'praise', 'other'],
      default: 'other',
    },
    platform: { type: String, default: '', maxlength: 40 },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'archived'],
      default: 'new',
      index: true,
    },
    adminNote: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true },
);

feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ user: 1, createdAt: -1 });

export const Feedback = mongoose.model<IFeedback>('Feedback', feedbackSchema);
