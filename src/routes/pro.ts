import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { User } from '../models/User';
import { ThemePackPricing } from '../models/ThemePackPricing';
import { ProPurchase } from '../models/ProPurchase';
import { ThemePurchase } from '../models/ThemePurchase';
import {
  ensureProCatalog,
  entitlementPayload,
  getProPlanConfig,
  SHARED_THEME_SKUS,
} from '../services/proEntitlements';
import { effectiveDailyTokens } from '../services/proEntitlements';
import {
  resolveProductSkus,
  verifyStorePurchase,
  verifyThemeStorePurchase,
} from '../services/iapVerify';
import { fetchPlayStorePrices } from '../services/playStorePrices';

const router = Router();

/** Public catalog — display prices from Google Play (fallback region IN). */
router.get('/catalog', async (_req, res: Response) => {
  try {
    await ensureProCatalog();
    const plan = await getProPlanConfig();
    const themes = await ThemePackPricing.find({ enabled: true })
      .sort({ sortOrder: 1 })
      .lean();
    const skus = await resolveProductSkus();
    const storePrices = await fetchPlayStorePrices('IN');
    const proMonthly = storePrices.proMonthly;
    const proYearly = storePrices.proYearly;
    const themeMonthly = storePrices.themeMonthly;
    const themePermanent = storePrices.themePermanent;
    const currency =
      proMonthly?.currency ||
      themePermanent?.currency ||
      plan?.currency ||
      'INR';
    res.json({
      pro: plan
        ? {
            name: plan.name,
            monthlyPrice: proMonthly?.amount ?? plan.monthlyPrice,
            yearlyPrice: proYearly?.amount ?? plan.yearlyPrice,
            monthlyPriceFormatted: proMonthly?.formatted || null,
            yearlyPriceFormatted: proYearly?.formatted || null,
            currency,
            dailyTokens: plan.dailyTokens,
            monthlyLabel: plan.monthlyLabel,
            yearlyLabel: plan.yearlyLabel,
            description: plan.description,
            features: plan.features || [],
            enabled: plan.enabled !== false,
            androidMonthlySku: (plan as any).androidMonthlySku || skus.monthly,
            androidYearlySku: (plan as any).androidYearlySku || skus.yearly,
            iosMonthlySku: (plan as any).iosMonthlySku || skus.monthly,
            iosYearlySku: (plan as any).iosYearlySku || skus.yearly,
          }
        : null,
      themes: themes.map((t) => ({
        packId: t.packId,
        name: t.name,
        monthlyPrice: themeMonthly?.amount ?? t.monthlyPrice,
        permanentPrice: themePermanent?.amount ?? t.permanentPrice,
        monthlyPriceFormatted: themeMonthly?.formatted || null,
        permanentPriceFormatted: themePermanent?.formatted || null,
        currency: themePermanent?.currency || themeMonthly?.currency || currency,
        includedInPro: t.includedInPro === true,
        monthlyLabel: t.monthlyLabel,
        permanentLabel: t.permanentLabel,
        subtitle: t.subtitle,
        // Shared across all packs — only 2 Play products for themes.
        androidMonthlySku: SHARED_THEME_SKUS.monthly,
        androidPermanentSku: SHARED_THEME_SKUS.permanent,
        iosMonthlySku: SHARED_THEME_SKUS.monthly,
        iosPermanentSku: SHARED_THEME_SKUS.permanent,
      })),
      themeStoreProducts: {
        monthlySku: SHARED_THEME_SKUS.monthly,
        permanentSku: SHARED_THEME_SKUS.permanent,
      },
      storePrices,
    });
  } catch (err) {
    console.error('Pro catalog error:', err);
    res.status(500).json({ error: 'Could not load catalog' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.userId).lean();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const dailyTokens = await effectiveDailyTokens(req.user!.userId);
    res.json({
      entitlement: entitlementPayload(user),
      dailyTokens,
    });
  } catch (err) {
    console.error('Pro me error:', err);
    res.status(500).json({ error: 'Could not load entitlement' });
  }
});

/**
 * Free /subscribe stub is disabled. Clients must pay via store IAP
 * then call /iap/verify. Admin can still grant Pro from the admin panel.
 */
router.post(
  '/subscribe',
  requireAuth,
  async (_req: AuthRequest, res: Response) => {
    res.status(410).json({
      error: 'Direct subscribe is disabled. Complete an in-app purchase.',
      code: 'IAP_REQUIRED',
    });
  }
);

/**
 * Verify Google Play / App Store purchase and activate Pro.
 */
router.post(
  '/iap/verify',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as {
        platform?: string;
        productId?: string;
        purchaseToken?: string;
        transactionId?: string;
        packageName?: string;
      };

      const platform =
        body.platform === 'ios'
          ? 'ios'
          : body.platform === 'android'
          ? 'android'
          : null;
      if (!platform) {
        res.status(400).json({ error: 'platform must be android or ios' });
        return;
      }

      const config = await getProPlanConfig();
      if (!config || config.enabled === false) {
        res.status(400).json({ error: 'Pro is not available right now' });
        return;
      }

      let verified;
      try {
        verified = await verifyStorePurchase({
          platform,
          productId: String(body.productId || ''),
          purchaseToken: String(body.purchaseToken || ''),
          transactionId: body.transactionId,
          packageName: body.packageName,
        });
      } catch (err: any) {
        const status = err?.status || 400;
        res
          .status(status)
          .json({ error: err?.message || 'Purchase verification failed' });
        return;
      }

      // Idempotent: same token already linked
      const existing = await ProPurchase.findOne({
        purchaseToken: verified.purchaseToken,
      });
      if (existing) {
        if (String(existing.userId) !== String(req.user!.userId)) {
          res.status(409).json({
            error: 'This purchase is already linked to another account',
          });
          return;
        }
        const user = await User.findByIdAndUpdate(
          req.user!.userId,
          {
            proPlan: existing.plan,
            proStatus: 'active',
            proExpiresAt: existing.expiresAt || verified.expiresAt,
            proProvider: platform === 'android' ? 'google_play' : 'app_store',
          },
          { new: true }
        ).lean();
        res.json({
          ok: true,
          entitlement: user ? entitlementPayload(user) : null,
          dailyTokens: config.dailyTokens,
          reused: true,
        });
        return;
      }

      await ProPurchase.create({
        userId: req.user!.userId,
        platform,
        productId: verified.productId,
        plan: verified.plan,
        purchaseToken: verified.purchaseToken,
        transactionId: verified.transactionId,
        orderId: verified.orderId || null,
        packageName: verified.packageName || null,
        expiresAt: verified.expiresAt,
        verified: true,
        raw: verified.raw,
      });

      const user = await User.findByIdAndUpdate(
        req.user!.userId,
        {
          proPlan: verified.plan,
          proStatus: 'active',
          proExpiresAt: verified.expiresAt,
          proProvider: platform === 'android' ? 'google_play' : 'app_store',
        },
        { new: true }
      ).lean();

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({
        ok: true,
        entitlement: entitlementPayload(user),
        dailyTokens: config.dailyTokens,
        plan: verified.plan,
        expiresAt: verified.expiresAt,
      });
    } catch (err) {
      console.error('IAP verify error:', err);
      res.status(500).json({ error: 'Could not verify purchase' });
    }
  }
);

/** Verify a theme subscription/non-consumable purchase and grant access. */
router.post(
  '/themes/iap/verify',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as {
        platform?: 'android' | 'ios';
        productId?: string;
        purchaseToken?: string;
        transactionId?: string;
        packageName?: string;
        packId?: string;
      };
      const platform = body.platform === 'ios' ? 'ios' : 'android';
      const verified = await verifyThemeStorePurchase({
        platform,
        productId: String(body.productId || ''),
        purchaseToken: String(body.purchaseToken || ''),
        transactionId: body.transactionId,
        packageName: body.packageName,
        packId: body.packId,
      });
      const existing = await ThemePurchase.findOne({
        purchaseToken: verified.purchaseToken,
        packId: verified.packId,
      });
      if (existing && String(existing.userId) !== String(req.user!.userId)) {
        res
          .status(409)
          .json({ error: 'This purchase is linked to another account' });
        return;
      }
      // Shared monthly token may already unlock a different pack for this user.
      const tokenOwner = await ThemePurchase.findOne({
        purchaseToken: verified.purchaseToken,
      });
      if (
        tokenOwner &&
        String(tokenOwner.userId) !== String(req.user!.userId)
      ) {
        res
          .status(409)
          .json({ error: 'This purchase is linked to another account' });
        return;
      }
      if (!existing) {
        await ThemePurchase.create({
          userId: req.user!.userId,
          platform,
          ...verified,
          verified: true,
        });
      }
      const user = await User.findById(req.user!.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      user.themePurchases = (user.themePurchases || []).filter(
        (p) => p.packId !== verified.packId
      );
      user.themePurchases.push({
        packId: verified.packId,
        kind: verified.kind,
        purchasedAt: new Date(),
        expiresAt: verified.expiresAt,
        provider: platform === 'android' ? 'google_play' : 'app_store',
      });
      await user.save();
      res.json({
        ok: true,
        entitlement: entitlementPayload(user),
      });
    } catch (err) {
      const status = (err as any)?.status || 500;
      console.error('Theme IAP verify error:', err);
      res.status(status).json({
        error: (err as any)?.message || 'Could not verify theme purchase',
      });
    }
  }
);

router.post(
  '/themes/purchase',
  requireAuth,
  async (_req: AuthRequest, res: Response) => {
    res.status(410).json({
      error: 'Direct theme purchase is disabled. Complete an in-app purchase.',
      code: 'IAP_REQUIRED',
    });
  }
);

export default router;
