import mongoose, { Schema, Document } from 'mongoose';

export type CategoryTermSource = 'seed' | 'user' | 'llm';

export interface ICategoryVote {
  category: string;
  count: number;
  /** Distinct users who voted this category (capped) */
  userIds: string[];
}

export interface ICategoryTerm extends Document {
  /** Normalized phrase / merchant label fragment */
  term: string;
  /** Winning / active category slug */
  category: string;
  /** Higher = stronger (seed starts high; user votes accumulate) */
  weight: number;
  votes: ICategoryVote[];
  source: CategoryTermSource;
  active: boolean;
  /** True while users disagree and LLM hasn't settled it */
  conflict: boolean;
  lastResolvedAt?: Date;
}

const voteSchema = new Schema<ICategoryVote>(
  {
    category: { type: String, required: true },
    count: { type: Number, default: 0 },
    userIds: { type: [String], default: [] },
  },
  { _id: false },
);

const categoryTermSchema = new Schema<ICategoryTerm>(
  {
    term: { type: String, required: true, unique: true, index: true },
    category: { type: String, required: true, index: true },
    weight: { type: Number, default: 1 },
    votes: { type: [voteSchema], default: [] },
    source: {
      type: String,
      enum: ['seed', 'user', 'llm'],
      default: 'user',
    },
    active: { type: Boolean, default: true },
    conflict: { type: Boolean, default: false },
    lastResolvedAt: { type: Date },
  },
  { timestamps: true },
);

categoryTermSchema.index({ 'votes.userIds': 1, active: 1 });

export const CategoryTerm = mongoose.model<ICategoryTerm>('CategoryTerm', categoryTermSchema);
