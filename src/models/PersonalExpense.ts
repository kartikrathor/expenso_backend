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

export interface IPersonalExpense extends Document {
  user: Types.ObjectId;
  clientId?: string;
  amount: number;
  merchantLabel: string;
  merchant: string;
  category: CategoryId;
  note: string;
  date: Date;
  inputMethod: 'voice' | 'manual';
  createdAt: Date;
  updatedAt: Date;
}

const personalExpenseSchema = new Schema<IPersonalExpense>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: String, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 0.01 },
    merchantLabel: { type: String, required: true, trim: true, maxlength: 80 },
    merchant: { type: String, default: 'default', maxlength: 40 },
    category: { type: String, default: 'other', maxlength: 40 },
    note: { type: String, default: '', maxlength: 300 },
    date: { type: Date, required: true, default: Date.now },
    inputMethod: { type: String, enum: ['voice', 'manual'], default: 'manual' },
  },
  { timestamps: true },
);

personalExpenseSchema.index({ user: 1, date: -1 });
personalExpenseSchema.index(
  { user: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientId: { $type: 'string' } },
  },
);

export const PersonalExpense = mongoose.model<IPersonalExpense>(
  'PersonalExpense',
  personalExpenseSchema,
);
