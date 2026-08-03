import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { User } from '../models/User';
import { ThemePackPricing } from '../models/ThemePackPricing';
import { ProPurchase } from '../models/ProPurchase';
import {
  addMonths,
  ensureProCatalog,
  entitlementPayload,
  getProPlanConfig,
} from '../services/proEntitlements';
import { effectiveDailyTokens } from '../services/proEntitlements';
import { resolveProductSkus, verifyStorePurchase } from '../services/iapVerify';

const router = Router();

/** Public catalog — prices from admin */
router.get('/catalog', async (_req, res: Response) => {
  try {
    await ensureProCatalog();
    const plan = await getProPlanConfig();
    const themes = await ThemePackPricing.find({ enabled: true })
      .sort({ sortOrder: 1 })
      .lean();
    const skus = await resolveProductSkus();
    res.json({
      pro: plan
        ? {
            name: plan.name,
            monthlyPrice: plan.monthlyPrice,
            yearlyPrice: plan.yearlyPrice,
            currency: plan.currency || 'INR',
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
      themes: themes.map(t => ({
        packId: t.packId,
        name: t.name,
        monthlyPrice: t.monthlyPrice,
        permanentPrice: t.permanentPrice,
        currency: t.currency || 'INR',
      })),
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
router.post('/subscribe', requireAuth, async (_req: AuthRequest, res: Response) => {
  res.status(410).json({
    error: 'Direct subscribe is disabled. Complete an in-app purchase.',
    code: 'IAP_REQUIRED',
  });
});

/**
 * Verify Google Play / App Store purchase and activate Pro.
 */
router.post('/iap/verify', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      platform?: string;
      productId?: string;
      purchaseToken?: string;
      transactionId?: string;
      packageName?: string;
    };

    const platform = body.platform === 'ios' ? 'ios' : body.platform === 'android' ? 'android' : null;
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
      res.status(status).json({ error: err?.message || 'Purchase verification failed' });
      return;
    }

    // Idempotent: same token already linked
    const existing = await ProPurchase.findOne({ purchaseToken: verified.purchaseToken });
    if (existing) {
      if (String(existing.userId) !== String(req.user!.userId)) {
        res.status(409).json({ error: 'This purchase is already linked to another account' });
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
        { new: true },
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
      { new: true },
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
});

/** Buy / rent a theme pack (separate from Pro). Still stub until theme IAP SKUs ship. */
router.post('/themes/purchase', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { packId, kind } = req.body as { packId?: string; kind?: string };
    if (!packId || typeof packId !== 'string') {
      res.status(400).json({ error: 'packId is required' });
      return;
    }
    if (kind !== 'monthly' && kind !== 'permanent') {
      res.status(400).json({ error: 'kind must be monthly or permanent' });
      return;
    }
    if (packId === 'ocean') {
      res.status(400).json({ error: 'Default theme is free' });
      return;
    }

    await ensureProCatalog();
    const pricing = await ThemePackPricing.findOne({ packId, enabled: true }).lean();
    if (!pricing) {
      res.status(404).json({ error: 'Theme not available' });
      return;
    }

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const now = new Date();
    const expiresAt = kind === 'monthly' ? addMonths(now, 1) : null;
    const price = kind === 'monthly' ? pricing.monthlyPrice : pricing.permanentPrice;

    user.themePurchases = (user.themePurchases || []).filter(p => p.packId !== packId);
    user.themePurchases.push({
      packId,
      kind,
      purchasedAt: now,
      expiresAt,
    });
    await user.save();

    res.json({
      ok: true,
      charged: price,
      currency: pricing.currency || 'INR',
      entitlement: entitlementPayload(user),
    });
  } catch (err) {
    console.error('Theme purchase error:', err);
    res.status(500).json({ error: 'Could not purchase theme' });
  }
});

export default router;
