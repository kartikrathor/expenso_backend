import {
  getAndroidPublisher,
  getPlayPackageName,
} from './googlePlayAuth';
import { SHARED_THEME_SKUS } from './proEntitlements';

const DEFAULT_PRO_SKUS = {
  monthly: 'com.kriovent.expenso.pro.monthly',
  yearly: 'com.kriovent.expenso.pro.yearly',
};

export type PlayMoney = {
  amount: number;
  currency: string;
  formatted: string;
  regionCode: string;
  productId: string;
  kind: 'subscription' | 'one_time';
  basePlanId?: string | null;
};

export type PlayStorePriceCatalog = {
  source: 'google_play';
  regionCode: string;
  fetchedAt: string;
  proMonthly: PlayMoney | null;
  proYearly: PlayMoney | null;
  themeMonthly: PlayMoney | null;
  themePermanent: PlayMoney | null;
  error?: string;
};

type PlayPrice = {
  currencyCode?: string | null;
  units?: string | null;
  nanos?: number | null;
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: PlayStorePriceCatalog }>();

function moneyFromPlay(
  price: PlayPrice | null | undefined,
  regionCode: string,
  productId: string,
  kind: PlayMoney['kind'],
  basePlanId?: string | null
): PlayMoney | null {
  if (!price?.currencyCode) return null;
  const units = Number(price.units || 0);
  const nanos = Number(price.nanos || 0);
  const amount = units + nanos / 1_000_000_000;
  const currency = price.currencyCode;
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).format(amount);
  } catch {
    formatted = `${currency} ${amount}`;
  }
  return {
    amount,
    currency,
    formatted,
    regionCode,
    productId,
    kind,
    basePlanId: basePlanId || null,
  };
}

async function priceForSubscription(
  productId: string,
  regionCode: string
): Promise<PlayMoney | null> {
  const androidpublisher = await getAndroidPublisher();
  if (!androidpublisher) return null;
  const packageName = getPlayPackageName();
  const res = await androidpublisher.monetization.subscriptions.get({
    packageName,
    productId,
  });
  const base = (res.data.basePlans || []).find(
    (b) => (b.state || '').includes('ACTIVE') || !!b.regionalConfigs?.length
  ) || (res.data.basePlans || [])[0];
  if (!base) return null;
  const regional =
    (base.regionalConfigs || []).find((r) => r.regionCode === regionCode) ||
    (base.regionalConfigs || []).find((r) => r.regionCode === 'US') ||
    (base.regionalConfigs || [])[0];
  return moneyFromPlay(
    regional?.price || null,
    regional?.regionCode || regionCode,
    productId,
    'subscription',
    base.basePlanId
  );
}

async function priceForOneTime(
  productId: string,
  regionCode: string
): Promise<PlayMoney | null> {
  const androidpublisher = await getAndroidPublisher();
  if (!androidpublisher) return null;
  const packageName = getPlayPackageName();
  const res = await androidpublisher.monetization.onetimeproducts.get({
    packageName,
    productId,
  });
  const option =
    (res.data.purchaseOptions || []).find((o) => o.state === 'ACTIVE') ||
    (res.data.purchaseOptions || [])[0];
  if (!option) return null;
  const regional =
    (option.regionalPricingAndAvailabilityConfigs || []).find(
      (r) => r.regionCode === regionCode
    ) ||
    (option.regionalPricingAndAvailabilityConfigs || []).find(
      (r) => r.regionCode === 'US'
    ) ||
    (option.regionalPricingAndAvailabilityConfigs || [])[0];
  return moneyFromPlay(
    regional?.price || null,
    regional?.regionCode || regionCode,
    productId,
    'one_time'
  );
}

export async function fetchPlayStorePrices(
  regionCode = 'IN'
): Promise<PlayStorePriceCatalog> {
  const region = (regionCode || 'IN').toUpperCase();
  const cached = cache.get(region);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const empty: PlayStorePriceCatalog = {
    source: 'google_play',
    regionCode: region,
    fetchedAt: new Date().toISOString(),
    proMonthly: null,
    proYearly: null,
    themeMonthly: null,
    themePermanent: null,
  };

  try {
    const androidpublisher = await getAndroidPublisher();
    if (!androidpublisher) {
      const miss = {
        ...empty,
        error:
          'Google Play service account is not configured on this server.',
      };
      cache.set(region, { at: Date.now(), value: miss });
      return miss;
    }

    // Prefer known Play product IDs (no DB needed). Admin SKU overrides stay on catalog.
    const [proMonthly, proYearly, themeMonthly, themePermanent] =
      await Promise.all([
        priceForSubscription(DEFAULT_PRO_SKUS.monthly, region).catch(
          () => null
        ),
        priceForSubscription(DEFAULT_PRO_SKUS.yearly, region).catch(() => null),
        priceForSubscription(SHARED_THEME_SKUS.monthly, region).catch(
          () => null
        ),
        priceForOneTime(SHARED_THEME_SKUS.permanent, region).catch(() => null),
      ]);

    const value: PlayStorePriceCatalog = {
      source: 'google_play',
      regionCode: region,
      fetchedAt: new Date().toISOString(),
      proMonthly,
      proYearly,
      themeMonthly,
      themePermanent,
    };
    cache.set(region, { at: Date.now(), value });
    return value;
  } catch (err: any) {
    const fail = {
      ...empty,
      error: err?.message || 'Could not load Play Console prices',
    };
    cache.set(region, { at: Date.now(), value: fail });
    return fail;
  }
}
