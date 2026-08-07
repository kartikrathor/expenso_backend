import mongoose, { Schema, Document } from 'mongoose';

export interface IThemePackPricing extends Document {
  packId: string;
  name: string;
  monthlyPrice: number;
  permanentPrice: number;
  currency: string;
  includedInPro: boolean;
  monthlyLabel: string;
  permanentLabel: string;
  subtitle: string;
  androidMonthlySku: string;
  androidPermanentSku: string;
  iosMonthlySku: string;
  iosPermanentSku: string;
  enabled: boolean;
  sortOrder: number;
  /** Marks applied pricing/SKU presets (e.g. uniform-14-49-v1). */
  pricingPreset?: string;
  createdAt: Date;
  updatedAt: Date;
}

const themePackPricingSchema = new Schema<IThemePackPricing>(
  {
    packId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    monthlyPrice: { type: Number, default: 14, min: 0 },
    permanentPrice: { type: Number, default: 49, min: 0 },
    currency: { type: String, default: 'INR' },
    includedInPro: { type: Boolean, default: false, index: true },
    monthlyLabel: { type: String, default: 'Monthly access', maxlength: 60 },
    permanentLabel: { type: String, default: 'Buy forever', maxlength: 60 },
    subtitle: { type: String, default: '', maxlength: 160 },
    androidMonthlySku: { type: String, default: '', maxlength: 180 },
    androidPermanentSku: { type: String, default: '', maxlength: 180 },
    iosMonthlySku: { type: String, default: '', maxlength: 180 },
    iosPermanentSku: { type: String, default: '', maxlength: 180 },
    enabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    pricingPreset: { type: String, default: '', maxlength: 40 },
  },
  { timestamps: true }
);

export const ThemePackPricing = mongoose.model<IThemePackPricing>(
  'ThemePackPricing',
  themePackPricingSchema
);
