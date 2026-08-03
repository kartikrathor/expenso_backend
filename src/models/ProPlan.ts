import mongoose, { Schema, Document } from 'mongoose';

/** Singleton-ish config: monthly + yearly Pro tiers */
export interface IProPlan extends Document {
  key: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  /** Daily Ask Expenso tokens for active Pro users */
  dailyTokens: number;
  monthlyLabel: string;
  yearlyLabel: string;
  description: string;
  features: string[];
  enabled: boolean;
  /** Google Play / App Store product IDs */
  androidMonthlySku: string;
  androidYearlySku: string;
  iosMonthlySku: string;
  iosYearlySku: string;
  updatedAt: Date;
  createdAt: Date;
}

const proPlanSchema = new Schema<IProPlan>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    name: { type: String, default: 'Expenso Pro' },
    monthlyPrice: { type: Number, default: 49, min: 0 },
    yearlyPrice: { type: Number, default: 399, min: 0 },
    currency: { type: String, default: 'INR' },
    dailyTokens: { type: Number, default: 500, min: 0 },
    monthlyLabel: { type: String, default: 'Pro Monthly' },
    yearlyLabel: { type: String, default: 'Pro Yearly' },
    description: {
      type: String,
      default:
        'Unlock Ask Expenso (500 tokens/day), analytics navigation, App Lock, biometrics & exports.',
    },
    features: {
      type: [String],
      default: [
        'ask_ai',
        'analytics_nav',
        'custom_date',
        'app_lock',
        'biometrics',
        'export_excel',
        'export_pdf',
      ],
    },
    enabled: { type: Boolean, default: true },
    androidMonthlySku: {
      type: String,
      default: 'com.kriovent.expenso.pro.monthly',
    },
    androidYearlySku: {
      type: String,
      default: 'com.kriovent.expenso.pro.yearly',
    },
    iosMonthlySku: {
      type: String,
      default: 'com.kriovent.expenso.pro.monthly',
    },
    iosYearlySku: {
      type: String,
      default: 'com.kriovent.expenso.pro.yearly',
    },
  },
  { timestamps: true },
);

export const ProPlan = mongoose.model<IProPlan>('ProPlan', proPlanSchema);
