import { Router, Response } from 'express';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { PersonalExpense } from '../models/PersonalExpense';
import { GroupExpense } from '../models/GroupExpense';
import { AssistantIntent, AssistantMiss } from '../models/AssistantIntent';
import { AssistantLearning } from '../models/AssistantLearning';
import { GlobalCategory, UserCategory } from '../models/Category';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { logLearning } from '../services/assistant/maintenance';
import { listCategoryTermsForAdmin } from '../services/categoryLearning';

const router = Router();
router.use(requireAuth, requireAdmin);

function paramStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'custom';
}

/** Dashboard stats */
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      active7d,
      active30d,
      intentCount,
      missCount,
      globalCats,
      suggestionGroups,
      personalExpenseCount,
      groupExpenseCount,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ lastActiveAt: { $gte: since7 } }),
      User.countDocuments({ lastActiveAt: { $gte: since30 } }),
      AssistantIntent.countDocuments({ active: true }),
      AssistantMiss.countDocuments(),
      GlobalCategory.countDocuments({ active: true }),
      UserCategory.aggregate([
        { $match: { active: true } },
        { $group: { _id: '$slug' } },
        { $count: 'n' },
      ]),
      PersonalExpense.countDocuments(),
      GroupExpense.countDocuments(),
    ]);

    res.json({
      totalUsers,
      recentlyActive7d: active7d,
      recentlyActive30d: active30d,
      activeIntents: intentCount,
      unmatchedQuestions: missCount,
      globalCategories: globalCats,
      uniqueUserCategorySuggestions: suggestionGroups[0]?.n ?? 0,
      personalExpenseCount,
      groupExpenseCount,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

/** Users list */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const users = await User.find()
      .select('name email role avatarColor lastActiveAt createdAt monthlyBudget')
      .sort({ lastActiveAt: -1 })
      .limit(limit);
    res.json({
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        avatarColor: u.avatarColor,
        lastActiveAt: u.lastActiveAt,
        createdAt: u.createdAt,
        monthlyBudget: u.monthlyBudget,
      })),
    });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Could not list users' });
  }
});

/** —— AI Intents (keyword Q&A) —— */
router.get('/intents', async (_req: AuthRequest, res: Response) => {
  try {
    const intents = await AssistantIntent.find().sort({ key: 1 });
    res.json({ intents });
  } catch (err) {
    console.error('Admin intents error:', err);
    res.status(500).json({ error: 'Could not list intents' });
  }
});

router.post('/intents', async (req: AuthRequest, res: Response) => {
  try {
    const { key, name, patterns, templates, chips, active } = req.body as {
      key?: string;
      name?: string;
      patterns?: string[];
      templates?: string[];
      chips?: string[];
      active?: boolean;
    };
    const cleanKey = (key || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleanKey || !name?.trim()) {
      res.status(400).json({ error: 'key and name are required' });
      return;
    }
    const existing = await AssistantIntent.findOne({ key: cleanKey });
    if (existing) {
      res.status(409).json({ error: 'Intent key already exists' });
      return;
    }
    const intent = await AssistantIntent.create({
      key: cleanKey,
      name: name.trim(),
      patterns: (patterns || []).map(p => p.trim()).filter(Boolean),
      templates: (templates || []).map(t => t.trim()).filter(Boolean),
      chips: (chips || []).map(c => c.trim()).filter(Boolean),
      active: active !== false,
    });
    await logLearning(
      (intent.patterns || []).map(pattern => ({
        intentKey: intent.key,
        intentName: intent.name,
        pattern,
        source: 'admin' as const,
      })),
    );
    res.status(201).json({ intent });
  } catch (err) {
    console.error('Admin create intent error:', err);
    res.status(500).json({ error: 'Could not create intent' });
  }
});

router.patch('/intents/:key', async (req: AuthRequest, res: Response) => {
  try {
    const intent = await AssistantIntent.findOne({ key: paramStr(req.params.key) });
    if (!intent) {
      res.status(404).json({ error: 'Intent not found' });
      return;
    }
    const { name, patterns, templates, chips, active } = req.body as {
      name?: string;
      patterns?: string[];
      templates?: string[];
      chips?: string[];
      active?: boolean;
    };
    if (name !== undefined) intent.name = name.trim();
    const beforePatterns = new Set((intent.patterns || []).map(p => p.toLowerCase()));
    if (patterns !== undefined) intent.patterns = patterns.map(p => p.trim()).filter(Boolean);
    if (templates !== undefined) intent.templates = templates.map(t => t.trim()).filter(Boolean);
    if (chips !== undefined) intent.chips = chips.map(c => c.trim()).filter(Boolean);
    if (active !== undefined) intent.active = active;
    await intent.save();

    if (patterns !== undefined) {
      const added = intent.patterns.filter(p => !beforePatterns.has(p.toLowerCase()));
      await logLearning(
        added.map(pattern => ({
          intentKey: intent.key,
          intentName: intent.name,
          pattern,
          source: 'admin' as const,
        })),
      );
    }

    res.json({ intent });
  } catch (err) {
    console.error('Admin update intent error:', err);
    res.status(500).json({ error: 'Could not update intent' });
  }
});

router.delete('/intents/:key', async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await AssistantIntent.findOneAndDelete({ key: paramStr(req.params.key) });
    if (!deleted) {
      res.status(404).json({ error: 'Intent not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Admin delete intent error:', err);
    res.status(500).json({ error: 'Could not delete intent' });
  }
});

/** Unmatched questions (for training) */
router.get('/misses', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const misses = await AssistantMiss.find().sort({ createdAt: -1 }).limit(limit);
    res.json({ misses });
  } catch (err) {
    console.error('Admin misses error:', err);
    res.status(500).json({ error: 'Could not list misses' });
  }
});

/** Patterns the system / Gemini / admin learned over time */
router.get('/learning', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(300, Number(req.query.limit) || 100);
    const source = typeof req.query.source === 'string' ? req.query.source : '';
    const filter: Record<string, unknown> = {};
    if (
      source &&
      ['gemini', 'groq', 'huggingface', 'admin', 'system', 'chip_click'].includes(source)
    ) {
      filter.source = source;
    }
    const [items, bySource] = await Promise.all([
      AssistantLearning.find(filter).sort({ createdAt: -1 }).limit(limit),
      AssistantLearning.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
    ]);
    const counts: Record<string, number> = {};
    for (const row of bySource) counts[row._id] = row.count;
    res.json({
      items,
      counts: {
        gemini: counts.gemini || 0,
        groq: counts.groq || 0,
        huggingface: counts.huggingface || 0,
        admin: counts.admin || 0,
        system: counts.system || 0,
        chip_click: counts.chip_click || 0,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      },
    });
  } catch (err) {
    console.error('Admin learning error:', err);
    res.status(500).json({ error: 'Could not list learning log' });
  }
});

/** Add a miss message as a pattern on an intent */
router.post('/misses/:id/promote', async (req: AuthRequest, res: Response) => {
  try {
    const { intentKey } = req.body as { intentKey?: string };
    if (!intentKey) {
      res.status(400).json({ error: 'intentKey required' });
      return;
    }
    const miss = await AssistantMiss.findById(paramStr(req.params.id));
    if (!miss) {
      res.status(404).json({ error: 'Miss not found' });
      return;
    }
    const intent = await AssistantIntent.findOne({ key: intentKey });
    if (!intent) {
      res.status(404).json({ error: 'Intent not found' });
      return;
    }
    const phrase = miss.message.trim().toLowerCase();
    if (phrase && !intent.patterns.includes(phrase)) {
      intent.patterns.push(phrase);
      await intent.save();
      await logLearning([
        {
          intentKey: intent.key,
          intentName: intent.name,
          pattern: phrase,
          source: 'admin',
          fromMessage: miss.message,
        },
      ]);
    }
    await miss.deleteOne();
    res.json({ intent, message: 'Pattern added & miss removed' });
  } catch (err) {
    console.error('Admin promote miss error:', err);
    res.status(500).json({ error: 'Could not promote miss' });
  }
});

/** —— Global categories —— */
router.get('/categories', async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await GlobalCategory.find().sort({ label: 1 });
    res.json({ categories });
  } catch (err) {
    console.error('Admin categories error:', err);
    res.status(500).json({ error: 'Could not list categories' });
  }
});

router.post('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const { label, labelHi, emoji, color, synonyms, slug } = req.body as {
      label?: string;
      labelHi?: string;
      emoji?: string;
      color?: string;
      synonyms?: string[];
      slug?: string;
    };
    if (!label?.trim()) {
      res.status(400).json({ error: 'label required' });
      return;
    }
    const cleanSlug = (slug || slugify(label)).toLowerCase();
    const existing = await GlobalCategory.findOne({ slug: cleanSlug });
    if (existing) {
      res.status(409).json({ error: 'Category slug already exists' });
      return;
    }
    const category = await GlobalCategory.create({
      slug: cleanSlug,
      label: label.trim(),
      labelHi: labelHi?.trim() || '',
      emoji: emoji || '📦',
      color: color || '#94A3B8',
      synonyms: (synonyms || []).map(s => s.trim()).filter(Boolean),
      active: true,
      source: 'admin',
    });
    res.status(201).json({ category });
  } catch (err) {
    console.error('Admin create category error:', err);
    res.status(500).json({ error: 'Could not create category' });
  }
});

router.patch('/categories/:slug', async (req: AuthRequest, res: Response) => {
  try {
    const category = await GlobalCategory.findOne({ slug: paramStr(req.params.slug) });
    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    const { label, labelHi, emoji, color, synonyms, active } = req.body as {
      label?: string;
      labelHi?: string;
      emoji?: string;
      color?: string;
      synonyms?: string[];
      active?: boolean;
    };
    if (label !== undefined) category.label = label.trim();
    if (labelHi !== undefined) category.labelHi = labelHi.trim();
    if (emoji !== undefined) category.emoji = emoji;
    if (color !== undefined) category.color = color;
    if (synonyms !== undefined) category.synonyms = synonyms.map(s => s.trim()).filter(Boolean);
    if (active !== undefined) category.active = active;
    await category.save();
    res.json({ category });
  } catch (err) {
    console.error('Admin update category error:', err);
    res.status(500).json({ error: 'Could not update category' });
  }
});

router.delete('/categories/:slug', async (req: AuthRequest, res: Response) => {
  try {
    const slug = paramStr(req.params.slug);
    if (['food', 'groceries', 'shopping', 'transport', 'entertainment', 'bills', 'health', 'other'].includes(slug)) {
      // Soft-disable built-ins instead of delete
      const category = await GlobalCategory.findOneAndUpdate(
        { slug },
        { active: false },
        { new: true },
      );
      res.json({ category, message: 'Built-in category disabled' });
      return;
    }
    const deleted = await GlobalCategory.findOneAndDelete({ slug });
    if (!deleted) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Admin delete category error:', err);
    res.status(500).json({ error: 'Could not delete category' });
  }
});

/**
 * Suggestions: user-created categories that look useful to promote globally.
 * Groups by slug/label, counts distinct users.
 */
router.get('/category-suggestions', async (_req: AuthRequest, res: Response) => {
  try {
    const globalSlugs = new Set(
      (await GlobalCategory.find({ active: true }).select('slug')).map(c => c.slug),
    );

    const grouped = await UserCategory.aggregate<{
      _id: string;
      label: string;
      emoji: string;
      color: string;
      users: number;
      useCount: number;
      sampleUserIds: Types.ObjectId[];
    }>([
      { $match: { active: true } },
      {
        $group: {
          _id: '$slug',
          label: { $first: '$label' },
          emoji: { $first: '$emoji' },
          color: { $first: '$color' },
          users: { $addToSet: '$user' },
          useCount: { $sum: '$useCount' },
        },
      },
      {
        $project: {
          label: 1,
          emoji: 1,
          color: 1,
          useCount: 1,
          users: { $size: '$users' },
          sampleUserIds: { $slice: ['$users', 5] },
        },
      },
      { $sort: { users: -1, useCount: -1 } },
      { $limit: 100 },
    ]);

    const suggestions = grouped
      .filter(g => !globalSlugs.has(g._id))
      .map(g => ({
        slug: g._id,
        label: g.label,
        emoji: g.emoji,
        color: g.color,
        userCount: g.users,
        useCount: g.useCount,
        alreadyGlobal: false,
        reason:
          g.users >= 2
            ? `${g.users} users added a similar category — good candidate to add globally`
            : 'One user created this — review before promoting',
      }));

    res.json({ suggestions });
  } catch (err) {
    console.error('Admin category suggestions error:', err);
    res.status(500).json({ error: 'Could not load suggestions' });
  }
});

/** Promote a user suggestion into global categories */
router.post('/category-suggestions/:slug/promote', async (req: AuthRequest, res: Response) => {
  try {
    const slug = paramStr(req.params.slug).toLowerCase();
    const sample = await UserCategory.findOne({ slug, active: true });
    if (!sample) {
      res.status(404).json({ error: 'No user category with this slug' });
      return;
    }
    const existing = await GlobalCategory.findOne({ slug });
    if (existing) {
      existing.active = true;
      existing.source = 'promoted';
      await existing.save();
      res.json({ category: existing, message: 'Re-activated existing global category' });
      return;
    }
    const category = await GlobalCategory.create({
      slug,
      label: sample.label,
      emoji: sample.emoji,
      color: sample.color,
      synonyms: [sample.label.toLowerCase()],
      active: true,
      source: 'promoted',
    });
    res.status(201).json({ category, message: 'Promoted to global — all users can use it' });
  } catch (err) {
    console.error('Admin promote category error:', err);
    res.status(500).json({ error: 'Could not promote category' });
  }
});

/** Self-learned / seeded keyword → category mappings */
router.get('/category-terms', async (_req: AuthRequest, res: Response) => {
  try {
    const terms = await listCategoryTermsForAdmin(150);
    res.json({
      terms: terms.map(t => ({
        term: t.term,
        category: t.category,
        weight: t.weight,
        source: t.source,
        active: t.active,
        conflict: t.conflict,
        votes: (t.votes || []).map(v => ({ category: v.category, count: v.count })),
      })),
    });
  } catch (err) {
    console.error('Admin category terms error:', err);
    res.status(500).json({ error: 'Could not load category terms' });
  }
});

export default router;
