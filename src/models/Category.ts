import mongoose, { Schema, Document, Types } from 'mongoose';

/** Curated categories managed from admin (includes built-ins after seed). */
export interface IGlobalCategory extends Document {
  slug: string;
  label: string;
  labelHi?: string;
  emoji: string;
  color: string;
  synonyms: string[];
  active: boolean;
  /** Promoted from user suggestions */
  source: 'system' | 'admin' | 'promoted';
  createdAt: Date;
  updatedAt: Date;
}

const globalCategorySchema = new Schema<IGlobalCategory>(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    labelHi: { type: String, default: '', maxlength: 40 },
    emoji: { type: String, default: '📦', maxlength: 8 },
    color: { type: String, default: '#94A3B8', maxlength: 20 },
    synonyms: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    source: { type: String, enum: ['system', 'admin', 'promoted'], default: 'admin' },
  },
  { timestamps: true },
);

export const GlobalCategory = mongoose.model<IGlobalCategory>('GlobalCategory', globalCategorySchema);

/** Per-user custom categories (also feed admin suggestions). */
export interface IUserCategory extends Document {
  user: Types.ObjectId;
  slug: string;
  label: string;
  emoji: string;
  color: string;
  active: boolean;
  /** How many expenses used this (updated loosely) */
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const userCategorySchema = new Schema<IUserCategory>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    emoji: { type: String, default: '✨', maxlength: 8 },
    color: { type: String, default: '#A855F7', maxlength: 20 },
    active: { type: Boolean, default: true },
    useCount: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);

userCategorySchema.index({ user: 1, slug: 1 }, { unique: true });
userCategorySchema.index({ slug: 1, active: 1 });

export const UserCategory = mongoose.model<IUserCategory>('UserCategory', userCategorySchema);
