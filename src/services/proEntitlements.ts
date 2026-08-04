import { User } from '../models/User';
import { ProPlan } from '../models/ProPlan';
import { ThemePackPricing } from '../models/ThemePackPricing';

export type ProPlanKey = 'monthly' | 'yearly';
export type ThemePurchaseKind = 'monthly' | 'permanent';

const DEFAULT_THEME_PACKS: Array<{
  packId: string;
  name: string;
  monthlyPrice: number;
  permanentPrice: number;
  sortOrder: number;
}> = [
  { packId: 'mint', name: 'Mint Money', monthlyPrice: 19, permanentPrice: 37, sortOrder: 10 },
  { packId: 'sunset', name: 'Sunset UPI', monthlyPrice: 19, permanentPrice: 37, sortOrder: 20 },
  { packId: 'royal', name: 'Royal', monthlyPrice: 19, permanentPrice: 37, sortOrder: 30 },
  { packId: 'rose', name: 'Rose', monthlyPrice: 19, permanentPrice: 37, sortOrder: 40 },
  { packId: 'lavender', name: 'Lavender', monthlyPrice: 19, permanentPrice: 37, sortOrder: 45 },
  { packId: 'mono', name: 'Mono', monthlyPrice: 19, permanentPrice: 37, sortOrder: 50 },
  { packId: 'forest', name: 'Forest Calm', monthlyPrice: 19, permanentPrice: 37, sortOrder: 60 },
  {
    packId: 'midnight_gold',
    name: 'Midnight Gold',
    monthlyPrice: 19,
    permanentPrice: 37,
    sortOrder: 70,
  },
  { packId: 'paper', name: 'Paper Ledger', monthlyPrice: 19, permanentPrice: 37, sortOrder: 80 },
  { packId: 'neon', name: 'Neon Spend', monthlyPrice: 19, permanentPrice: 37, sortOrder: 90 },
  {
    packId: 'red_web_spider',
    name: 'Red Web Spider',
    monthlyPrice: 19,
    permanentPrice: 37,
    sortOrder: 100,
  },
];

export async function ensureProCatalog() {
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

  for (const pack of DEFAULT_THEME_PACKS) {
    await ThemePackPricing.findOneAndUpdate(
      { packId: pack.packId },
      { $setOnInsert: { ...pack, currency: 'INR', enabled: true } },
      { upsert: true },
    );
  }
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
    themePurchases?: Array<{ packId: string; kind: string; expiresAt?: Date | null }>;
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
  }>;
}) {
  const active = isProActive(user);
  return {
    isPro: active,
    plan: active ? user.proPlan || null : null,
    status: active ? 'active' : user.proStatus || 'none',
    expiresAt: user.proExpiresAt || null,
    ownedThemePacks: ownedThemePackIds(user),
    themePurchases: (user.themePurchases || []).map(p => ({
      packId: p.packId,
      kind: p.kind,
      purchasedAt: p.purchasedAt || null,
      expiresAt: p.expiresAt || null,
    })),
  };
}
