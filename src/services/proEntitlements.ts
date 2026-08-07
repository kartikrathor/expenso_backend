import { User } from '../models/User';
import { ProPlan } from '../models/ProPlan';
import { ThemePackPricing } from '../models/ThemePackPricing';
import { ThemePurchase } from '../models/ThemePurchase';

export type ProPlanKey = 'monthly' | 'yearly';
export type ThemePurchaseKind = 'monthly' | 'permanent';

/** Initial uniform theme pricing (Play products use matching SKUs). */
const DEFAULT_THEME_MONTHLY_PRICE = 14;
const DEFAULT_THEME_PERMANENT_PRICE = 49;

/**
 * Shared store products for every paid theme pack.
 * Play Console only needs these two (+ Pro monthly/yearly).
 * Which pack unlocks is chosen in-app and sent as packId on verify.
 */
export const SHARED_THEME_SKUS = {
  monthly: 'com.kriovent.expenso.theme.monthly',
  permanent: 'com.kriovent.expenso.theme.permanent',
} as const;

const DEFAULT_THEME_PACKS: Array<{
  packId: string;
  name: string;
  monthlyPrice: number;
  permanentPrice: number;
  sortOrder: number;
  includedInPro?: boolean;
}> = [
  {
    packId: 'mint',
    name: 'Mint Money',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 10,
    includedInPro: true,
  },
  {
    packId: 'sunset',
    name: 'Sunset UPI',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 20,
  },
  {
    packId: 'royal',
    name: 'Royal',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 30,
  },
  {
    packId: 'rose',
    name: 'Rose',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 40,
    includedInPro: true,
  },
  {
    packId: 'lavender',
    name: 'Lavender',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 45,
  },
  {
    packId: 'mono',
    name: 'Mono',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 50,
  },
  {
    packId: 'forest',
    name: 'Forest Calm',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 60,
  },
  {
    packId: 'midnight_gold',
    name: 'Midnight Gold',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 70,
    includedInPro: true,
  },
  {
    packId: 'paper',
    name: 'Paper Ledger',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 80,
  },
  {
    packId: 'neon',
    name: 'Neon Spend',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 90,
  },
  {
    packId: 'red_web_spider',
    name: 'Red Web Spider',
    monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
    permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
    sortOrder: 100,
  },
];

let catalogReady: Promise<void> | null = null;

export async function ensureProCatalog() {
  if (!catalogReady) {
    catalogReady = seedProCatalog().catch((err) => {
      catalogReady = null;
      throw err;
    });
  }
  return catalogReady;
}

async function seedProCatalog() {
  // Old unique(purchaseToken) blocks shared theme SKUs unlocking multiple packs.
  try {
    await ThemePurchase.collection.dropIndex('purchaseToken_1');
  } catch {
    // index may not exist
  }

  await ProPlan.findOneAndUpdate(
    { key: 'default' },
    {
      $setOnInsert: {
        key: 'default',
        name: 'Expenso Pro',
        monthlyPrice: 49,
        yearlyPrice: 399,
        currency: 'INR',
        dailyTokens: 500,
        monthlyLabel: 'Pro Monthly',
        yearlyLabel: 'Pro Yearly',
        description:
          'Unlock Ask Expenso (500 tokens/day), analytics navigation, App Lock, biometrics & exports.',
        features: [
          'ask_ai',
          'analytics_nav',
          'custom_date',
          'app_lock',
          'biometrics',
          'export_excel',
          'export_pdf',
        ],
        enabled: true,
        androidMonthlySku: 'com.kriovent.expenso.pro.monthly',
        androidYearlySku: 'com.kriovent.expenso.pro.yearly',
        iosMonthlySku: 'com.kriovent.expenso.pro.monthly',
        iosYearlySku: 'com.kriovent.expenso.pro.yearly',
      },
    },
    { upsert: true, new: true },
  );

  await Promise.all(
    DEFAULT_THEME_PACKS.map((pack) => {
      return ThemePackPricing.findOneAndUpdate(
        { packId: pack.packId },
        {
          $setOnInsert: {
            ...pack,
            includedInPro: pack.includedInPro === true,
            currency: 'INR',
            enabled: true,
            monthlyLabel: 'Monthly access',
            permanentLabel: 'Buy forever',
            subtitle: 'Unlock this color pack and matching app icon.',
            androidMonthlySku: SHARED_THEME_SKUS.monthly,
            androidPermanentSku: SHARED_THEME_SKUS.permanent,
            iosMonthlySku: SHARED_THEME_SKUS.monthly,
            iosPermanentSku: SHARED_THEME_SKUS.permanent,
          },
        },
        { upsert: true },
      );
    }),
  );

  const migrationOps: any[] = [];
  for (const pack of DEFAULT_THEME_PACKS) {
    const defaults: Record<string, string | boolean> = {
      includedInPro: pack.includedInPro === true,
      monthlyLabel: 'Monthly access',
      permanentLabel: 'Buy forever',
      subtitle: 'Unlock this color pack and matching app icon.',
      androidMonthlySku: SHARED_THEME_SKUS.monthly,
      androidPermanentSku: SHARED_THEME_SKUS.permanent,
      iosMonthlySku: SHARED_THEME_SKUS.monthly,
      iosPermanentSku: SHARED_THEME_SKUS.permanent,
    };
    for (const [field, value] of Object.entries(defaults)) {
      migrationOps.push({
        updateOne: {
          filter: { packId: pack.packId, [field]: { $exists: false } },
          update: { $set: { [field]: value } },
        },
      });
    }
  }
  if (migrationOps.length) await ThemePackPricing.bulkWrite(migrationOps);

  // Shared store SKUs + uniform ₹14 / ₹49 for every pack.
  const SHARED_PRESET = 'shared-theme-sku-v1';
  await ThemePackPricing.bulkWrite(
    DEFAULT_THEME_PACKS.map((pack) => ({
      updateOne: {
        filter: {
          packId: pack.packId,
          pricingPreset: { $ne: SHARED_PRESET },
        },
        update: {
          $set: {
            monthlyPrice: DEFAULT_THEME_MONTHLY_PRICE,
            permanentPrice: DEFAULT_THEME_PERMANENT_PRICE,
            androidMonthlySku: SHARED_THEME_SKUS.monthly,
            androidPermanentSku: SHARED_THEME_SKUS.permanent,
            iosMonthlySku: SHARED_THEME_SKUS.monthly,
            iosPermanentSku: SHARED_THEME_SKUS.permanent,
            pricingPreset: SHARED_PRESET,
          },
        },
      },
    })),
  );
}

export function isProActive(user: {
  proPlan?: string | null;
  proStatus?: string | null;
  proExpiresAt?: Date | null;
}): boolean {
  if (user.proStatus !== 'active') return false;
  if (!user.proExpiresAt) return true;
  return new Date(user.proExpiresAt).getTime() > Date.now();
}

export function ownedThemePackIds(user: {
  themePurchases?: Array<{
    packId: string;
    kind: string;
    expiresAt?: Date | null;
  }>;
}): string[] {
  const now = Date.now();
  const owned = new Set<string>();
  for (const p of user.themePurchases || []) {
    if (p.kind === 'permanent') {
      owned.add(p.packId);
      continue;
    }
    if (p.expiresAt && new Date(p.expiresAt).getTime() > now) {
      owned.add(p.packId);
    }
  }
  return [...owned];
}

export function canUseThemePack(
  user: {
    proPlan?: string | null;
    proStatus?: string | null;
    proExpiresAt?: Date | null;
    themePurchases?: Array<{
      packId: string;
      kind: string;
      expiresAt?: Date | null;
    }>;
  },
  packId: string,
): boolean {
  if (packId === 'ocean') return true;
  return ownedThemePackIds(user).includes(packId);
}

export async function getProPlanConfig() {
  await ensureProCatalog();
  return ProPlan.findOne({ key: 'default' }).lean();
}

export async function effectiveDailyTokens(userId: string): Promise<number> {
  const user = await User.findById(userId)
    .select('proPlan proStatus proExpiresAt proDailyTokensOverride')
    .lean();
  if (!user || !isProActive(user)) return 0;
  if (
    typeof user.proDailyTokensOverride === 'number' &&
    user.proDailyTokensOverride >= 0
  ) {
    return Math.floor(user.proDailyTokensOverride);
  }
  const plan = await getProPlanConfig();
  const n = plan?.dailyTokens ?? 500;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export function entitlementPayload(user: {
  proPlan?: string | null;
  proStatus?: string | null;
  proExpiresAt?: Date | null;
  themePurchases?: Array<{
    packId: string;
    kind: string;
    purchasedAt?: Date;
    expiresAt?: Date | null;
    provider?: string;
  }>;
}) {
  const active = isProActive(user);
  return {
    isPro: active,
    plan: active ? user.proPlan || null : null,
    status: active ? 'active' : user.proStatus || 'none',
    expiresAt: user.proExpiresAt || null,
    ownedThemePacks: ownedThemePackIds(user),
    themePurchases: (user.themePurchases || []).map((p) => ({
      packId: p.packId,
      kind: p.kind,
      purchasedAt: p.purchasedAt || null,
      expiresAt: p.expiresAt || null,
      provider: p.provider || 'legacy',
    })),
  };
}
