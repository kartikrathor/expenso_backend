import mongoose, { Schema, Document } from 'mongoose';

export interface IThemePackPricing extends Document {
  packId: string;
  name: string;
  monthlyPrice: number;
  permanentPrice: number;
  currency: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const themePackPricingSchema = new Schema<IThemePackPricing>(
  {
    packId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    monthlyPrice: { type: Number, default: 19, min: 0 },
    permanentPrice: { type: Number, default: 37, min: 0 },
    currency: { type: String, default: 'INR' },
    enabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true },
);

export const ThemePackPricing = mongoose.model<IThemePackPricing>(
  'ThemePackPricing',
  themePackPricingSchema,
);
