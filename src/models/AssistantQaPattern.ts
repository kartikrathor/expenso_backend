import mongoose, { Schema, Document } from 'mongoose';

export type QaPatternSource = 'llm' | 'precise' | 'admin';

/**
 * Learned from Gemini/Groq/HF answers: question keywords → preferred reply style.
 * Used to steer future LLM prompts (not a rules template).
 */
export interface IAssistantQaPattern extends Document {
  /** Sorted keyword join for upsert */
  fingerprint: string;
  keywords: string[];
  /** How to shape the next similar answer */
  styleHint: string;
  /** Exemplar with amounts scrubbed (tone only) */
  sampleAnswer?: string;
  weight: number;
  hits: number;
  /** Distinct users who triggered this pattern (capped) */
  userIds: string[];
  active: boolean;
  lastSource: QaPatternSource;
}

const assistantQaPatternSchema = new Schema<IAssistantQaPattern>(
  {
    fingerprint: { type: String, required: true, unique: true, index: true },
    keywords: { type: [String], required: true, index: true },
    styleHint: { type: String, required: true, maxlength: 600 },
    sampleAnswer: { type: String, maxlength: 500 },
    weight: { type: Number, default: 1 },
    hits: { type: Number, default: 1 },
    userIds: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    lastSource: {
      type: String,
      enum: ['llm', 'precise', 'admin'],
      default: 'llm',
    },
  },
  { timestamps: true },
);

assistantQaPatternSchema.index({ active: 1, weight: -1, hits: -1 });

export const AssistantQaPattern = mongoose.model<IAssistantQaPattern>(
  'AssistantQaPattern',
  assistantQaPatternSchema,
);
