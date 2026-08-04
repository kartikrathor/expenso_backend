import mongoose, { Schema, Document } from 'mongoose';

export type QaPatternSource = 'llm' | 'precise' | 'admin';

/**
 * Learned from Gemini/Groq/HF (and especially “Need more accurate”) answers:
 * question keywords → preferred reply style + optional rules template.
 * Used to steer future LLM prompts AND local rules replies.
 */
export interface IAssistantQaPattern extends Document {
  /** Sorted keyword join for upsert */
  fingerprint: string;
  keywords: string[];
  /** Original user question (trimmed) for intent pattern promotion */
  questionSample?: string;
  /** How to shape the next similar answer */
  styleHint: string;
  /** Exemplar with amounts scrubbed (tone only) */
  sampleAnswer?: string;
  /**
   * Reply skeleton with {placeholders} derived from a good Gemini/precise answer.
   * Filled with live stats on the rules path so local AI can sound like that advisor.
   */
  replyTemplate?: string;
  /** Best-matching intent key when we taught this Q→A */
  intentKey?: string;
  /** True when user tapped “Need a more accurate answer” (rules reply was not good enough) */
  wasCorrection?: boolean;
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
    questionSample: { type: String, maxlength: 500 },
    styleHint: { type: String, required: true, maxlength: 600 },
    sampleAnswer: { type: String, maxlength: 500 },
    replyTemplate: { type: String, maxlength: 600 },
    intentKey: { type: String, index: true },
    wasCorrection: { type: Boolean, default: false },
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
assistantQaPatternSchema.index({ active: 1, intentKey: 1, weight: -1 });

export const AssistantQaPattern = mongoose.model<IAssistantQaPattern>(
  'AssistantQaPattern',
  assistantQaPatternSchema,
);
