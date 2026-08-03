import mongoose, { Schema, Document } from 'mongoose';

export interface IGlobalMerchant extends Document {
  slug: string;
  label: string;
  keywords: string[];
  category: string;
  color: string;
  bgColor: string;
  iconLetter: string;
  /** Absolute or path URL for brand logo (preferred) */
  iconUrl: string;
  /** Domain used to auto-fetch logo (e.g. swiggy.com) */
  domain: string;
  active: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const globalMerchantSchema = new Schema<IGlobalMerchant>(
  {
    slug: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true },
    keywords: { type: [String], default: [] },
    category: { type: String, default: 'other' },
    color: { type: String, default: '#A0A0B8' },
    bgColor: { type: String, default: '#252538' },
    iconLetter: { type: String, default: '?' },
    iconUrl: { type: String, default: '' },
    domain: { type: String, default: '' },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true },
);

export const GlobalMerchant = mongoose.model<IGlobalMerchant>(
  'GlobalMerchant',
  globalMerchantSchema,
);
