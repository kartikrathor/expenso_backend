import { google } from 'googleapis';
import {
  addMonths,
  addYears,
  getProPlanConfig,
} from './proEntitlements';

export type IapPlatform = 'android' | 'ios';
export type IapPlan = 'monthly' | 'yearly';

export type VerifyIapInput = {
  platform: IapPlatform;
  productId: string;
  purchaseToken: string;
  transactionId?: string | null;
  packageName?: string | null;
};

export type VerifyIapResult = {
  ok: true;
  plan: IapPlan;
  productId: string;
  purchaseToken: string;
  transactionId: string;
  orderId?: string | null;
  packageName?: string | null;
  expiresAt: Date;
  raw?: Record<string, unknown>;
};

const DEFAULT_SKUS = {
  monthly: 'com.kriovent.expenso.pro.monthly',
  yearly: 'com.kriovent.expenso.pro.yearly',
};

export async function resolveProductSkus(): Promise<{
  monthly: string;
  yearly: string;
}> {
  const plan = await getProPlanConfig();
  return {
    monthly: (plan as any)?.androidMonthlySku || DEFAULT_SKUS.monthly,
    yearly: (plan as any)?.androidYearlySku || DEFAULT_SKUS.yearly,
  };
}

export async function planForProductId(productId: string): Promise<IapPlan | null> {
  const skus = await resolveProductSkus();
  if (productId === skus.monthly) return 'monthly';
  if (productId === skus.yearly) return 'yearly';
  // Allow ios aliases if configured same fields for now
  const iosMonthly = (await getProPlanConfig() as any)?.iosMonthlySku;
  const iosYearly = (await getProPlanConfig() as any)?.iosYearlySku;
  if (iosMonthly && productId === iosMonthly) return 'monthly';
  if (iosYearly && productId === iosYearly) return 'yearly';
  return null;
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
    return null;
  }
}

async function verifyAndroidPurchase(input: VerifyIapInput): Promise<VerifyIapResult> {
  const plan = await planForProductId(input.productId);
  if (!plan) {
    throw Object.assign(new Error('Unknown productId'), { status: 400 });
  }

  const packageName =
    input.packageName ||
    process.env.GOOGLE_PLAY_PACKAGE_NAME ||
    'com.kriovent.expenso';

  const credentials = parseServiceAccount();
  const skipVerify =
    (process.env.IAP_SKIP_VERIFY || '').toLowerCase() === 'true' ||
    (process.env.IAP_SKIP_VERIFY || '') === '1';

  if (!credentials) {
    if (!skipVerify) {
      throw Object.assign(
        new Error(
          'Google Play verification is not configured. Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.',
        ),
        { status: 503 },
      );
    }
    // Dev-only bypass — never enable in production
    console.warn('[IAP] Skipping Google verify (IAP_SKIP_VERIFY=true)');
    const now = new Date();
    return {
      ok: true,
      plan,
      productId: input.productId,
      purchaseToken: input.purchaseToken,
      transactionId: input.transactionId || input.purchaseToken.slice(0, 64),
      packageName,
      expiresAt: plan === 'yearly' ? addYears(now, 1) : addMonths(now, 1),
      raw: { skippedVerify: true },
    };
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const androidpublisher = google.androidpublisher({ version: 'v3', auth });

  // Prefer subscriptionsv2 (Play Billing 5+ / base plans)
  try {
    const res = await androidpublisher.purchases.subscriptionsv2.get({
      packageName,
      token: input.purchaseToken,
    });
    const data = res.data as any;
    const lineItems = data?.lineItems || [];
    const item =
      lineItems.find((li: any) => li?.productId === input.productId) || lineItems[0];
    const expiryRaw = item?.expiryTime as string | undefined;
    const state = String(data?.subscriptionState || '');
    if (state && !state.includes('ACTIVE') && !state.includes('IN_GRACE')) {
      throw Object.assign(new Error(`Subscription not active (${state})`), { status: 400 });
    }
    const expiresAt = expiryRaw
      ? new Date(expiryRaw)
      : plan === 'yearly'
        ? addYears(new Date(), 1)
        : addMonths(new Date(), 1);
    if (expiresAt.getTime() <= Date.now()) {
      throw Object.assign(new Error('Subscription already expired'), { status: 400 });
    }
    return {
      ok: true,
      plan,
      productId: input.productId,
      purchaseToken: input.purchaseToken,
      transactionId:
        input.transactionId ||
        data?.latestOrderId ||
        data?.startTime ||
        input.purchaseToken.slice(0, 64),
      orderId: data?.latestOrderId || null,
      packageName,
      expiresAt,
      raw: data,
    };
  } catch (err: any) {
    if (err?.status === 400) throw err;
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Google Play verification failed';
    throw Object.assign(new Error(msg), { status: err?.status || 400 });
  }
}

async function verifyIosPurchase(input: VerifyIapInput): Promise<VerifyIapResult> {
  const plan = await planForProductId(input.productId);
  if (!plan) {
    throw Object.assign(new Error('Unknown productId'), { status: 400 });
  }

  const skipVerify =
    (process.env.IAP_SKIP_VERIFY || '').toLowerCase() === 'true' ||
    (process.env.IAP_SKIP_VERIFY || '') === '1';

  // Full App Store Server API can be wired later. For now require skip or a shared secret stub.
  if (!skipVerify && !process.env.APPLE_IAP_SHARED_SECRET) {
    throw Object.assign(
      new Error('Apple IAP verification is not configured yet. Use Android or set IAP_SKIP_VERIFY for testing.'),
      { status: 503 },
    );
  }

  const now = new Date();
  return {
    ok: true,
    plan,
    productId: input.productId,
    purchaseToken: input.purchaseToken,
    transactionId: input.transactionId || input.purchaseToken.slice(0, 64),
    packageName: null,
    expiresAt: plan === 'yearly' ? addYears(now, 1) : addMonths(now, 1),
    raw: { skippedVerify: skipVerify || true, platform: 'ios' },
  };
}

export async function verifyStorePurchase(input: VerifyIapInput): Promise<VerifyIapResult> {
  if (!input.purchaseToken?.trim()) {
    throw Object.assign(new Error('purchaseToken is required'), { status: 400 });
  }
  if (!input.productId?.trim()) {
    throw Object.assign(new Error('productId is required'), { status: 400 });
  }
  if (input.platform === 'android') return verifyAndroidPurchase(input);
  if (input.platform === 'ios') return verifyIosPurchase(input);
  throw Object.assign(new Error('platform must be android or ios'), { status: 400 });
}
