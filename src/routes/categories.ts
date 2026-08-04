import { Router, Response } from 'express';
import { GlobalCategory, UserCategory } from '../models/Category';
import { PersonalExpense } from '../models/PersonalExpense';
import { GroupExpense } from '../models/GroupExpense';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { touchUserActive } from '../middleware/admin';
import {
  getActiveCategoryTermMap,
  recordCategoryCorrection,
} from '../services/categoryLearning';
import {
  searchIconifySuggestions,
  suggestEmojisForLabel,
} from '../services/categoryIcons';

const router = Router();

function paramStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

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

function publicBase(req: AuthRequest): string {
  const env = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  if (env) return env;
  const host = req.get('host') || `localhost:${process.env.PORT || 4000}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function absoluteIconUrl(req: AuthRequest, iconUrl: string | undefined): string {
  if (!iconUrl) return '';
  if (/^https?:\/\//i.test(iconUrl)) return iconUrl;
  if (iconUrl.startsWith('/')) return `${publicBase(req)}${iconUrl}`;
  return iconUrl;
}

const BUILTIN_FALLBACK = [
  { slug: 'food', label: 'Food', labelHi: 'खाना', emoji: '🍔', color: '#F472B6', iconUrl: '' },
  { slug: 'groceries', label: 'Groceries', labelHi: 'किराना', emoji: '🛒', color: '#10B981', iconUrl: '' },
  { slug: 'shopping', label: 'Shopping', labelHi: 'खरीदारी', emoji: '🛍️', color: '#818CF8', iconUrl: '' },
  { slug: 'transport', label: 'Transport', labelHi: 'यातायात', emoji: '🚗', color: '#38BDF8', iconUrl: '' },
  { slug: 'entertainment', label: 'Entertainment', labelHi: 'मनोरंजन', emoji: '🎬', color: '#FBBF24', iconUrl: '' },
  { slug: 'bills', label: 'Bills', labelHi: 'बिल', emoji: '📱', color: '#06B6D4', iconUrl: '' },
  { slug: 'rent', label: 'Rent', labelHi: 'किराया', emoji: '🏠', color: '#A78BFA', iconUrl: '' },
  { slug: 'taxes', label: 'Taxes', labelHi: 'कर', emoji: '🧾', color: '#FB923C', iconUrl: '' },
  { slug: 'gifts', label: 'Gifts', labelHi: 'उपहार', emoji: '🎁', color: '#E879F9', iconUrl: '' },
  { slug: 'donation', label: 'Donation', labelHi: 'दान', emoji: '🤝', color: '#34D399', iconUrl: '' },
  { slug: 'insurance', label: 'Insurance', labelHi: 'बीमा', emoji: '🛡️', color: '#0EA5E9', iconUrl: '' },
  { slug: 'personal_care', label: 'Personal Care', labelHi: 'पर्सनल केयर', emoji: '💇', color: '#D946EF', iconUrl: '' },
  { slug: 'health', label: 'Health', labelHi: 'स्वास्थ्य', emoji: '💊', color: '#F87171', iconUrl: '' },
  { slug: 'other', label: 'Other', labelHi: 'अन्य', emoji: '📦', color: '#94A3B8', iconUrl: '' },
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
        iconUrl: absoluteIconUrl(req, (c as any).iconUrl || ''),
        color: c.color,
        source: 'global' as const,
      })),
      custom: mine.map(c => ({
        id: c.slug,
        label: c.label,
        labelHi: '',
        emoji: c.emoji,
        iconUrl: absoluteIconUrl(req, c.iconUrl || ''),
        color: c.color,
        source: 'custom' as const,
      })),
    });
  } catch (err) {
    console.error('List categories error:', err);
    res.status(500).json({ error: 'Could not list categories' });
  }
});

/**
 * Emoji + SVG suggestions for a category label (app picker).
 * GET /api/categories/icon-suggestions?q=Pets
 */
router.get('/icon-suggestions', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    touchUserActive(req.user!.userId);
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      res.json({ emojis: suggestEmojisForLabel(''), icons: [] });
      return;
    }
    const emojis = suggestEmojisForLabel(q);
    let icons: { key: string; url: string }[] = [];
    try {
      icons = await searchIconifySuggestions(q, 12);
    } catch (err) {
      console.warn('Icon suggestions fetch failed:', err);
    }
    res.json({ emojis, icons });
  } catch (err) {
    console.error('Icon suggestions error:', err);
    res.status(500).json({ error: 'Could not load icon suggestions' });
  }
});

/** Create a personal custom category (also becomes an admin suggestion). */
router.post('/custom', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    touchUserActive(userId);
    const { label, emoji, color, iconUrl } = req.body as {
      label?: string;
      emoji?: string;
      color?: string;
      iconUrl?: string;
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
          iconUrl: absoluteIconUrl(req, (globalHit as any).iconUrl || ''),
          color: globalHit.color,
          source: 'global',
        },
      });
      return;
    }

    const safeIcon =
      typeof iconUrl === 'string' &&
      (/^https?:\/\//i.test(iconUrl.trim()) || iconUrl.trim().startsWith('/uploads/'))
        ? iconUrl.trim().slice(0, 500)
        : '';

    const category = await UserCategory.findOneAndUpdate(
      { user: userId, slug },
      {
        $set: {
          label: label.trim(),
          emoji: (emoji || '✨').slice(0, 8),
          iconUrl: safeIcon,
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
        iconUrl: absoluteIconUrl(req, category.iconUrl || ''),
        color: category.color,
        source: 'custom',
      },
    });
  } catch (err) {
    console.error('Create custom category error:', err);
    res.status(500).json({ error: 'Could not create category' });
  }
});

/**
 * Soft-delete a user custom category and move their expenses with that
 * category to "other".
 */
router.delete('/custom/:slug', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const slug = paramStr(req.params.slug).toLowerCase();
    touchUserActive(userId);

    const deleted = await UserCategory.findOneAndUpdate(
      { user: userId, slug },
      { active: false },
      { new: true },
    );
    if (!deleted) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const [personal, group] = await Promise.all([
      PersonalExpense.updateMany(
        { user: userId, category: slug },
        { $set: { category: 'other' } },
      ),
      GroupExpense.updateMany(
        {
          category: slug,
          $or: [{ createdBy: userId }, { paidBy: userId }],
        },
        { $set: { category: 'other' } },
      ),
    ]);

    const movedCount = (personal.modifiedCount || 0) + (group.modifiedCount || 0);
    res.json({
      message: 'Removed',
      movedCount,
      movedTo: 'other',
    });
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
