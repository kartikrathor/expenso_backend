import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IThemePurchaseRecord extends Document {
  userId: Types.ObjectId;
  platform: 'android' | 'ios';
  productId: string;
  packId: string;
  kind: 'monthly' | 'permanent';
  purchaseToken: string;
  transactionId: string;
  orderId?: string | null;
  packageName?: string | null;
  expiresAt?: Date | null;
  verified: boolean;
  raw?: Record<string, unknown>;
}

const themePurchaseSchema = new Schema<IThemePurchaseRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    productId: { type: String, required: true, index: true },
    packId: { type: String, required: true, index: true },
    kind: { type: String, enum: ['monthly', 'permanent'], required: true },
    // Same Play token can unlock multiple packs (shared theme SKUs).
    purchaseToken: { type: String, required: true, index: true },
    transactionId: { type: String, required: true },
    orderId: { type: String, default: null },
    packageName: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    verified: { type: Boolean, default: false },
    raw: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

themePurchaseSchema.index(
  { purchaseToken: 1, packId: 1 },
  { unique: true }
);

export const ThemePurchase = mongoose.model<IThemePurchaseRecord>(
  'ThemePurchase',
  themePurchaseSchema
);
