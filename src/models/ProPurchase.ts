import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProPurchase extends Document {
  userId: Types.ObjectId;
  platform: 'android' | 'ios';
  productId: string;
  plan: 'monthly' | 'yearly';
  /** Google purchaseToken or Apple transaction id / JWS */
  purchaseToken: string;
  transactionId: string;
  orderId?: string | null;
  packageName?: string | null;
  expiresAt: Date | null;
  verified: boolean;
  raw?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const proPurchaseSchema = new Schema<IProPurchase>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    productId: { type: String, required: true },
    plan: { type: String, enum: ['monthly', 'yearly'], required: true },
    purchaseToken: { type: String, required: true, unique: true },
    transactionId: { type: String, required: true, index: true },
    orderId: { type: String, default: null },
    packageName: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    verified: { type: Boolean, default: false },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const ProPurchase = mongoose.model<IProPurchase>('ProPurchase', proPurchaseSchema);
