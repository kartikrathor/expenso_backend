import mongoose, { Schema, Document } from 'mongoose';

export interface IAssistantUsage extends Document {
  userId: string;
  day: string; // YYYY-MM-DD UTC
  /** Tokens consumed today (pool resets daily) */
  tokensUsed: number;
  /** Legacy / analytics: how many LLM calls today */
  aiCalls: number;
}

const assistantUsageSchema = new Schema<IAssistantUsage>(
  {
    userId: { type: String, required: true, index: true },
    day: { type: String, required: true, index: true },
    tokensUsed: { type: Number, default: 0 },
    aiCalls: { type: Number, default: 0 },
  },
  { timestamps: true },
);

assistantUsageSchema.index({ userId: 1, day: 1 }, { unique: true });

export const AssistantUsage = mongoose.model<IAssistantUsage>(
  'AssistantUsage',
  assistantUsageSchema,
);
