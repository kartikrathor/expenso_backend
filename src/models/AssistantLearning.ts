import mongoose, { Schema, Document } from 'mongoose';

export type LearningSource =
  | 'gemini'
  | 'groq'
  | 'huggingface'
  | 'admin'
  | 'system'
  | 'chip_click';

export interface IAssistantLearning extends Document {
  intentKey: string;
  intentName: string;
  /** New pattern OR chip label that was tapped */
  pattern: string;
  /** Where the learning signal came from */
  source: LearningSource;
  /**
   * For Gemini/admin: unmatched user message that triggered expand.
   * For chip_click: assistant reply after which the chip was shown/tapped.
   */
  fromMessage?: string;
  /** Intent of the assistant turn that showed the chips (chip_click only) */
  afterIntent?: string;
  /** All chips that were visible when user tapped one (chip_click) */
  chipsShown?: string[];
  createdAt: Date;
}

const assistantLearningSchema = new Schema<IAssistantLearning>(
  {
    intentKey: { type: String, required: true, index: true },
    intentName: { type: String, default: '' },
    pattern: { type: String, required: true, maxlength: 120 },
    source: {
      type: String,
      enum: ['gemini', 'groq', 'huggingface', 'admin', 'system', 'chip_click'],
      required: true,
      index: true,
    },
    fromMessage: { type: String, maxlength: 500 },
    afterIntent: { type: String, maxlength: 80 },
    chipsShown: { type: [String], default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

assistantLearningSchema.index({ createdAt: -1 });

export const AssistantLearning = mongoose.model<IAssistantLearning>(
  'AssistantLearning',
  assistantLearningSchema,
);
