import { Router, Response } from 'express';
import { GlobalCategory, UserCategory } from '../models/Category';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { touchUserActive } from '../middleware/admin';
import {
  getActiveCategoryTermMap,
  recordCategoryCorrection,
} from '../services/categoryLearning';

const router = Router();

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'custom'
  );
}

const BUILTIN_FALLBACK = [
  { slug: 'food', label: 'Food', labelHi: 'खाना', emoji: '🍔', color: '#F472B6' },
  { slug: 'groceries', label: 'Groceries', labelHi: 'किराना', emoji: '🛒', color: '#10B981' },
  { slug: 'shopping', label: 'Shopping', labelHi: 'खरीदारी', emoji: '🛍️', color: '#818CF8' },
  { slug: 'transport', label: 'Transport', labelHi: 'यातायात', emoji: '🚗', color: '#38BDF8' },
  { slug: 'entertainment', label: 'Entertainment', labelHi: 'मनोरंजन', emoji: '🎬', color: '#FBBF24' },
  { slug: 'bills', label: 'Bills', labelHi: 'बिल', emoji: '📱', color: '#06B6D4' },
  { slug: 'health', label: 'Health', labelHi: 'स्वास्थ्य', emoji: '💊', color: '#F87171' },
  { slug: 'other', label: 'Other', labelHi: 'अन्य', emoji: '📦', color: '#94A3B8' },
];

/** Global + this user's custom categories (for expense pickers). */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    touchUserActive(req.user!.userId);
    let global = await GlobalCategory.find({ active: true }).sort({ label: 1 });
    if (global.length === 0) {
      global = BUILTIN_FALLBACK.map(c => ({ ...c, synonyms: [], source: 'system', active: true })) as any;
    }
    const mine = await UserCategory.find({ user: req.user!.userId, active: true }).sort({
      label: 1,
    });

    res.json({
      global: global.map(c => ({
        id: c.slug,
        label: c.label,
        labelHi: c.labelHi || '',
        emoji: c.emoji,
        color: c.color,
        source: 'global' as const,
      })),
      custom: mine.map(c => ({
        id: c.slug,
        label: c.label,
        labelHi: '',
        emoji: c.emoji,
        color: c.color,
        source: 'custom' as const,
      })),
    });
  } catch (err) {
    console.error('List categories error:', err);
    res.status(500).json({ error: 'Could not list categories' });
  }
});

/** Create a personal custom category (also becomes an admin suggestion). */
router.post('/custom', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    touchUserActive(userId);
    const { label, emoji, color } = req.body as {
      label?: string;
      emoji?: string;
      color?: string;
    };
    if (!label?.trim()) {
      res.status(400).json({ error: 'label required' });
      return;
    }
    const slug = slugify(label);
    const globalHit = await GlobalCategory.findOne({ slug, active: true });
    if (globalHit) {
      res.status(409).json({
        error: `“${globalHit.label}” already exists as a global category — just pick it`,
        category: {
          id: globalHit.slug,
          label: globalHit.label,
          emoji: globalHit.emoji,
          color: globalHit.color,
          source: 'global',
        },
      });
      return;
    }

    const category = await UserCategory.findOneAndUpdate(
      { user: userId, slug },
      {
        $set: {
          label: label.trim(),
          emoji: emoji || '✨',
          color: color || '#A855F7',
          active: true,
        },
        $setOnInsert: { useCount: 1 },
      },
      { upsert: true, new: true },
    );

    res.status(201).json({
      category: {
        id: category.slug,
        label: category.label,
        emoji: category.emoji,
        color: category.color,
        source: 'custom',
      },
    });
  } catch (err) {
    console.error('Create custom category error:', err);
    res.status(500).json({ error: 'Could not create category' });
  }
});

router.delete('/custom/:slug', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await UserCategory.findOneAndUpdate(
      { user: req.user!.userId, slug: req.params.slug },
      { active: false },
      { new: true },
    );
    if (!deleted) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ message: 'Removed' });
  } catch (err) {
    console.error('Delete custom category error:', err);
    res.status(500).json({ error: 'Could not delete category' });
  }
});

/** Learned + seeded keyword → category map for the app parser */
router.get('/terms', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    touchUserActive(req.user!.userId);
    const terms = await getActiveCategoryTermMap();
    res.json({ terms });
  } catch (err) {
    console.error('Category terms error:', err);
    res.status(500).json({ error: 'Could not load category terms' });
  }
});

/**
 * Explicit learning signal (optional — PATCH expense also learns).
 * Useful when user picks a different category at add-confirm time.
 */
router.post('/learn', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    touchUserActive(userId);
    const { fromCategory, toCategory, merchantLabel, note } = req.body as {
      fromCategory?: string;
      toCategory?: string;
      merchantLabel?: string;
      note?: string;
    };
    if (!toCategory?.trim()) {
      res.status(400).json({ error: 'toCategory required' });
      return;
    }
    const result = await recordCategoryCorrection({
      userId,
      fromCategory,
      toCategory,
      merchantLabel,
      note,
    });
    res.json(result);
  } catch (err) {
    console.error('Category learn error:', err);
    res.status(500).json({ error: 'Could not record learning' });
  }
});

export default router;
