import mongoose, { Schema, Document } from 'mongoose';

export interface IAssistantIntent extends Document {
  key: string;
  name: string;
  patterns: string[];
  templates: string[];
  chips?: string[];
  active: boolean;
}

const assistantIntentSchema = new Schema<IAssistantIntent>(
  {
    key: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    patterns: { type: [String], default: [] },
    templates: { type: [String], default: [] },
    chips: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const AssistantIntent = mongoose.model<IAssistantIntent>(
  'AssistantIntent',
  assistantIntentSchema,
);

export interface IAssistantMiss extends Document {
  userId?: string;
  message: string;
  createdAt: Date;
}

const assistantMissSchema = new Schema<IAssistantMiss>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AssistantMiss = mongoose.model<IAssistantMiss>(
  'AssistantMiss',
  assistantMissSchema,
);
