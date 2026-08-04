import mongoose, { Schema, Document, Types } from 'mongoose';

export type CategoryId =
  | 'food'
  | 'groceries'
  | 'shopping'
  | 'transport'
  | 'entertainment'
  | 'bills'
  | 'health'
  | 'other';

export interface IGroupExpense extends Document {
  group: Types.ObjectId;
  clientId?: string;
  amount: number;
  merchantLabel: string;
  category: CategoryId;
  note: string;
  date: Date;
  paidBy: Types.ObjectId;
  /** Who shares this expense — empty = all current members */
  splitAmong: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const groupExpenseSchema = new Schema<IGroupExpense>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    clientId: { type: String, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 0.01 },
    merchantLabel: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, default: 'other', maxlength: 40 },
    note: { type: String, default: '', maxlength: 300 },
    date: { type: Date, required: true, default: Date.now },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    splitAmong: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

groupExpenseSchema.index({ group: 1, date: -1 });
groupExpenseSchema.index(
  { group: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientId: { $type: 'string' } },
  },
);

export const GroupExpense = mongoose.model<IGroupExpense>('GroupExpense', groupExpenseSchema);
