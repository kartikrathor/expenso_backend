import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { PersonalExpense } from '../models/PersonalExpense';
import { GroupExpense } from '../models/GroupExpense';
import { AssistantIntent, AssistantMiss } from '../models/AssistantIntent';
import { AssistantLearning } from '../models/AssistantLearning';
import { AssistantQaPattern } from '../models/AssistantQaPattern';
import { GlobalCategory, UserCategory } from '../models/Category';
import { Feedback } from '../models/Feedback';
import { SupportTicket } from '../models/SupportTicket';
import { PasswordResetRequest } from '../models/PasswordResetRequest';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { logLearning } from '../services/assistant/maintenance';
import { listCategoryTermsForAdmin } from '../services/categoryLearning';
import {
  categoryUploadDir,
  downloadCategoryIconFromUrl,
  fetchRelatedCategorySvg,
  unlinkCategoryIcon,
} from '../services/categoryIcons';
import { sendPushToUser, sendPushToUsers, isPushConfigured } from '../services/push';
import { ProPlan } from '../models/ProPlan';
import { ThemePackPricing } from '../models/ThemePackPricing';
import {
  addMonths,
  addYears,
  ensureProCatalog,
  entitlementPayload,
  getProPlanConfig,
} from '../services/proEntitlements';
import {
  generateOtp,
  generateVerificationToken,
  hashSecret,
  issueTempPasswordForRequest,
  resetRequestCode,
  serializeResetForClient,
} from '../services/passwordReset';

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

function serializeCategory(req: AuthRequest, c: any) {
  const plain = typeof c.toObject === 'function' ? c.toObject() : c;
  return {
    ...plain,
    iconUrl: absoluteIconUrl(req, plain.iconUrl || ''),
  };
}

const categoryIconUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, categoryUploadDir());
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 1.5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype) ||
      file.mimetype === 'image/svg+xml' ||
      /\.(svg|png|jpe?g|webp|gif)$/i.test(file.originalname || '');
    if (!ok) {
      cb(new Error('Only SVG / PNG / JPG / WebP / GIF uploads allowed'));
      return;
    }
    cb(null, true);
  },
});

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
      newFeedback,
      openTickets,
      unreadTickets,
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
      Feedback.countDocuments({ status: 'new' }),
      SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      SupportTicket.countDocuments({ unreadByAdmin: true }),
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
      newFeedback,
      openTickets,
      unreadTickets,
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
      .select(
        'name email role avatarColor lastActiveAt lastLoginAt lastLoginDeviceId devices mustChangePassword createdAt monthlyBudget proPlan proStatus proExpiresAt themePurchases',
      )
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
        lastLoginAt: u.lastLoginAt,
        lastLoginDeviceId: u.lastLoginDeviceId || '',
        deviceCount: (u.devices || []).length,
        devices: (u.devices || []).slice(0, 5).map(d => ({
          deviceId: d.deviceId,
          platform: d.platform,
          lastSeenAt: d.lastSeenAt,
        })),
        mustChangePassword: !!u.mustChangePassword,
        createdAt: u.createdAt,
        monthlyBudget: u.monthlyBudget,
        pro: entitlementPayload(u),
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

/** Q&A style patterns learned from Gemini/precise answers */
router.get('/qa-patterns', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 80);
    const activeOnly = String(req.query.active || '') === '1';
    const filter: Record<string, unknown> = {};
    if (activeOnly) filter.active = true;
    const [patterns, total, active] = await Promise.all([
      AssistantQaPattern.find(filter).sort({ hits: -1, weight: -1 }).limit(limit),
      AssistantQaPattern.countDocuments(),
      AssistantQaPattern.countDocuments({ active: true }),
    ]);
    res.json({ patterns, total, active });
  } catch (err) {
    console.error('Admin QA patterns error:', err);
    res.status(500).json({ error: 'Could not list QA patterns' });
  }
});

router.patch('/qa-patterns/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const { active, styleHint } = req.body as { active?: boolean; styleHint?: string };
    const update: Record<string, unknown> = {};
    if (typeof active === 'boolean') update.active = active;
    if (typeof styleHint === 'string' && styleHint.trim()) {
      update.styleHint = styleHint.trim().slice(0, 600);
      update.lastSource = 'admin';
    }
    if (!Object.keys(update).length) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    const pattern = await AssistantQaPattern.findByIdAndUpdate(id, update, { new: true });
    if (!pattern) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ pattern });
  } catch (err) {
    console.error('Admin QA pattern patch error:', err);
    res.status(500).json({ error: 'Could not update QA pattern' });
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
router.get('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const categories = await GlobalCategory.find().sort({ label: 1 });
    res.json({ categories: categories.map(c => serializeCategory(req, c)) });
  } catch (err) {
    console.error('Admin categories error:', err);
    res.status(500).json({ error: 'Could not list categories' });
  }
});

router.post('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const { label, labelHi, emoji, color, synonyms, slug, iconUrl } = req.body as {
      label?: string;
      labelHi?: string;
      emoji?: string;
      color?: string;
      synonyms?: string[];
      slug?: string;
      iconUrl?: string;
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
      iconUrl: typeof iconUrl === 'string' ? iconUrl.trim() : '',
      color: color || '#94A3B8',
      synonyms: (synonyms || []).map(s => s.trim()).filter(Boolean),
      active: true,
      source: 'admin',
    });
    res.status(201).json({ category: serializeCategory(req, category) });
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
    const { label, labelHi, emoji, color, synonyms, active, iconUrl } = req.body as {
      label?: string;
      labelHi?: string;
      emoji?: string;
      color?: string;
      synonyms?: string[];
      active?: boolean;
      iconUrl?: string;
    };
    if (label !== undefined) category.label = label.trim();
    if (labelHi !== undefined) category.labelHi = labelHi.trim();
    if (emoji !== undefined) category.emoji = emoji;
    if (color !== undefined) category.color = color;
    if (synonyms !== undefined) category.synonyms = synonyms.map(s => s.trim()).filter(Boolean);
    if (active !== undefined) category.active = active;
    if (iconUrl !== undefined) {
      if (!iconUrl && category.iconUrl) unlinkCategoryIcon(category.iconUrl);
      category.iconUrl = typeof iconUrl === 'string' ? iconUrl.trim() : '';
    }
    await category.save();
    res.json({ category: serializeCategory(req, category) });
  } catch (err) {
    console.error('Admin update category error:', err);
    res.status(500).json({ error: 'Could not update category' });
  }
});

router.post(
  '/categories/:slug/icon',
  (req, res, next) => {
    categoryIconUpload.single('icon')(req, res, err => {
      if (err) {
        res.status(400).json({ error: err.message || 'Upload failed' });
        return;
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    try {
      const category = await GlobalCategory.findOne({ slug: paramStr(req.params.slug) });
      if (!category) {
        res.status(404).json({ error: 'Category not found' });
        return;
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ error: 'No icon file uploaded (field name: icon)' });
        return;
      }
      unlinkCategoryIcon(category.iconUrl);
      category.iconUrl = `/uploads/categories/${file.filename}`;
      category.iconSourceKey = '';
      await category.save();
      res.json({ category: serializeCategory(req, category) });
    } catch (err) {
      console.error('Admin category icon upload error:', err);
      res.status(500).json({ error: 'Could not upload icon' });
    }
  },
);

/** Fetch a related SVG from Iconify (or download a direct image URL).
 *  Re-fetch skips already-shown icons so each click cycles to a new option.
 */
router.post('/categories/:slug/fetch-icon', async (req: AuthRequest, res: Response) => {
  try {
    const category = await GlobalCategory.findOne({ slug: paramStr(req.params.slug) });
    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    const query =
      (typeof req.body?.query === 'string' && req.body.query.trim()) ||
      category.label ||
      category.slug;
    const directUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';

    const tried = Array.isArray(category.iconTriedKeys) ? [...category.iconTriedKeys] : [];
    if (category.iconSourceKey && !tried.includes(category.iconSourceKey)) {
      tried.push(category.iconSourceKey);
    }

    let downloaded = directUrl
      ? await downloadCategoryIconFromUrl(directUrl)
      : await fetchRelatedCategorySvg(query, { exclude: tried });

    if (!downloaded && !directUrl) {
      // fallback: try slug words
      downloaded = await fetchRelatedCategorySvg(category.slug.replace(/_/g, ' '), {
        exclude: tried,
      });
    }

    if (!downloaded) {
      res.status(502).json({
        error: directUrl
          ? 'Could not download that image URL'
          : `No related SVG found for “${query}” — try a different search word`,
      });
      return;
    }

    const dir = categoryUploadDir();
    fs.writeFileSync(path.join(dir, downloaded.fileName), downloaded.buffer);
    unlinkCategoryIcon(category.iconUrl);
    category.iconUrl = `/uploads/categories/${downloaded.fileName}`;

    if (downloaded.iconKey) {
      const nextTried = [...tried, downloaded.iconKey];
      // Keep list bounded; if huge, trim oldest so cycle can restart fresh later
      category.iconTriedKeys = nextTried.slice(-40);
      category.iconSourceKey = downloaded.iconKey;
    } else {
      category.iconSourceKey = '';
    }

    await category.save();
    res.json({
      category: serializeCategory(req, category),
      iconKey: downloaded.iconKey || null,
    });
  } catch (err) {
    console.error('Admin category fetch-icon error:', err);
    res.status(500).json({ error: 'Could not fetch icon' });
  }
});

router.delete('/categories/:slug/icon', async (req: AuthRequest, res: Response) => {
  try {
    const category = await GlobalCategory.findOne({ slug: paramStr(req.params.slug) });
    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    unlinkCategoryIcon(category.iconUrl);
    category.iconUrl = '';
    category.iconSourceKey = '';
    category.iconTriedKeys = [];
    await category.save();
    res.json({ category: serializeCategory(req, category) });
  } catch (err) {
    console.error('Admin category clear icon error:', err);
    res.status(500).json({ error: 'Could not clear icon' });
  }
});

router.delete('/categories/:slug', async (req: AuthRequest, res: Response) => {
  try {
    const slug = paramStr(req.params.slug);
    if (['food', 'groceries', 'shopping', 'transport', 'entertainment', 'bills', 'rent', 'taxes', 'gifts', 'donation', 'insurance', 'personal_care', 'health', 'other'].includes(slug)) {
      // Soft-disable built-ins instead of delete
      const category = await GlobalCategory.findOneAndUpdate(
        { slug },
        { active: false },
        { new: true },
      );
      res.json({
        category: category ? serializeCategory(req, category) : category,
        message: 'Built-in category disabled',
      });
      return;
    }
    const deleted = await GlobalCategory.findOneAndDelete({ slug });
    if (!deleted) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    unlinkCategoryIcon(deleted.iconUrl);
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

function ticketCode(id: string): string {
  return `EXP-${String(id).slice(-6).toUpperCase()}`;
}

/** Feedback inbox */
router.get('/feedback', async (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const limit = Math.min(200, Number(req.query.limit) || 80);
    const filter: Record<string, unknown> = {};
    if (status && ['new', 'reviewed', 'archived'].includes(status)) {
      filter.status = status;
    }
    const items = await Feedback.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      feedback: items.map(d => {
        const u = d.user as any;
        return {
          id: d.id,
          message: d.message,
          category: d.category,
          platform: d.platform,
          status: d.status,
          adminNote: d.adminNote || '',
          createdAt: d.createdAt,
          user: u
            ? { id: String(u._id || u.id), name: u.name, email: u.email }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error('Admin feedback list error:', err);
    res.status(500).json({ error: 'Could not load feedback' });
  }
});

router.patch('/feedback/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const doc = await Feedback.findById(id);
    if (!doc) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }
    if (req.body?.status !== undefined) {
      const s = String(req.body.status);
      if (!['new', 'reviewed', 'archived'].includes(s)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      doc.status = s as any;
    }
    if (req.body?.adminNote !== undefined) {
      doc.adminNote = String(req.body.adminNote).slice(0, 1000);
    }
    await doc.save();
    res.json({
      feedback: {
        id: doc.id,
        status: doc.status,
        adminNote: doc.adminNote,
      },
    });
  } catch (err) {
    console.error('Admin feedback patch error:', err);
    res.status(500).json({ error: 'Could not update feedback' });
  }
});

/** Support tickets */
router.get('/support/tickets', async (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const unread = String(req.query.unread || '').trim();
    const limit = Math.min(200, Number(req.query.limit) || 80);
    const filter: Record<string, unknown> = {};
    if (status && ['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      filter.status = status;
    }
    if (unread === '1' || unread === 'true') {
      filter.unreadByAdmin = true;
    }
    const items = await SupportTicket.find(filter)
      .populate('user', 'name email')
      .sort({ unreadByAdmin: -1, lastMessageAt: -1, updatedAt: -1 })
      .limit(limit);

    const unreadCount = await SupportTicket.countDocuments({ unreadByAdmin: true });

    res.json({
      unreadCount,
      tickets: items.map(d => serializeAdminTicket(d)),
    });
  } catch (err) {
    console.error('Admin tickets list error:', err);
    res.status(500).json({ error: 'Could not load tickets' });
  }
});

function serializeAdminTicket(doc: InstanceType<typeof SupportTicket>) {
  const u = doc.user as any;
  const lastReply = (doc.replies || [])[(doc.replies || []).length - 1];
  const unreadByAdmin =
    typeof doc.unreadByAdmin === 'boolean'
      ? doc.unreadByAdmin
      : !lastReply || lastReply.role === 'user';

  return {
    id: doc.id,
    code: ticketCode(doc.id),
    subject: doc.subject,
    body: doc.body,
    category: doc.category,
    status: doc.status,
    platform: doc.platform,
    adminNote: doc.adminNote || '',
    replies: doc.replies || [],
    unread: !!unreadByAdmin,
    unreadByAdmin: !!unreadByAdmin,
    lastMessageAt: doc.lastMessageAt || doc.updatedAt,
    lastMessageRole: doc.lastMessageRole || lastReply?.role || 'user',
    lastMessagePreview: doc.lastMessagePreview || (lastReply?.message || doc.body || '').slice(0, 140),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    resolvedAt: doc.resolvedAt || null,
    user: u?._id || u?.id
      ? { id: String(u._id || u.id), name: u.name, email: u.email }
      : null,
  };
}

router.patch('/support/tickets/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const doc = await SupportTicket.findById(id);
    if (!doc) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    if (req.body?.status !== undefined) {
      const s = String(req.body.status);
      if (!['open', 'in_progress', 'resolved', 'closed'].includes(s)) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      doc.status = s as any;
      if (s === 'resolved' || s === 'closed') {
        doc.resolvedAt = doc.resolvedAt || new Date();
      } else {
        doc.resolvedAt = undefined;
      }
    }
    if (req.body?.adminNote !== undefined) {
      doc.adminNote = String(req.body.adminNote).slice(0, 2000);
    }

    // Explicit read / unread toggles for admin inbox
    if (req.body?.markRead === true || req.body?.unreadByAdmin === false) {
      doc.unreadByAdmin = false;
    }
    if (req.body?.markUnread === true || req.body?.unreadByAdmin === true) {
      doc.unreadByAdmin = true;
    }

    if (req.body?.reply) {
      const message = String(req.body.reply).trim();
      if (message.length >= 2 && message.length <= 4000) {
        const admin = await User.findById(req.user!.userId).select('name');
        const now = new Date();
        doc.replies.push({
          role: 'admin',
          message,
          authorName: admin?.name || 'Support',
          createdAt: now,
        });
        doc.unreadByUser = true;
        doc.unreadByAdmin = false;
        doc.lastMessageAt = now;
        doc.lastMessageRole = 'admin';
        doc.lastMessagePreview =
          message.length > 140 ? `${message.slice(0, 140)}…` : message;
        if (doc.status === 'open') doc.status = 'in_progress';
      }
    }

    await doc.save();
    await doc.populate('user', 'name email');

    let pushSent = 0;
    // Push to the ticket owner when support replies
    if (req.body?.reply && String(req.body.reply).trim().length >= 2) {
      const ownerId = String((doc.user as any)?._id || doc.user || '');
      const preview = String(req.body.reply).trim().slice(0, 120);
      try {
        pushSent = await sendPushToUser(ownerId, {
          title: 'Support replied',
          body: preview || `New reply on ${ticketCode(doc.id)}`,
          data: {
            type: 'support_reply',
            ticketId: doc.id,
            code: ticketCode(doc.id),
          },
        });
      } catch (err) {
        console.warn('Push notify failed:', err);
      }
    }

    res.json({
      ticket: serializeAdminTicket(doc),
      pushSent,
      pushConfigured: isPushConfigured(),
    });
  } catch (err) {
    console.error('Admin ticket patch error:', err);
    res.status(500).json({ error: 'Could not update ticket' });
  }
});

/** Manual / broadcast push from admin panel */
router.post('/notifications', async (req: AuthRequest, res: Response) => {
  try {
    if (!isPushConfigured()) {
      res.status(503).json({
        error:
          'Push not configured. Add firebase-service-account.json and restart the API.',
      });
      return;
    }

    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (title.length < 2 || body.length < 2) {
      res.status(400).json({ error: 'Title and message are required' });
      return;
    }
    if (title.length > 80 || body.length > 500) {
      res.status(400).json({ error: 'Title or message is too long' });
      return;
    }

    const target = String(req.body?.target || 'all').toLowerCase();
    let userIds: string[] = [];

    if (target === 'all') {
      // Anyone with a registered device — including admin accounts that use the app
      const users = await User.find({
        'fcmTokens.0': { $exists: true },
      })
        .select('_id')
        .limit(2000);
      userIds = users.map(u => u.id);
    } else if (target === 'users') {
      const raw = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      userIds = raw.map((id: unknown) => String(id)).filter(Boolean);
      if (!userIds.length) {
        res.status(400).json({ error: 'Select at least one user' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Invalid target' });
      return;
    }

    const result = await sendPushToUsers(userIds, {
      title,
      body,
      data: {
        type: 'admin_broadcast',
      },
    });

    res.json({
      ok: true,
      targetedUsers: userIds.length,
      ...result,
    });
  } catch (err) {
    console.error('Admin send notification error:', err);
    res.status(500).json({ error: 'Could not send notifications' });
  }
});

router.get('/notifications/status', async (_req: AuthRequest, res: Response) => {
  try {
    const withTokens = await User.countDocuments({
      'fcmTokens.0': { $exists: true },
    });
    const sample = await User.find({ 'fcmTokens.0': { $exists: true } })
      .select('name email role fcmTokens')
      .limit(20)
      .lean();
    res.json({
      configured: isPushConfigured(),
      usersWithDevices: withTokens,
      devices: sample.map(u => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role || 'user',
        tokenCount: Array.isArray(u.fcmTokens) ? u.fcmTokens.length : 0,
      })),
    });
  } catch (err) {
    console.error('Admin notification status error:', err);
    res.status(500).json({ error: 'Could not load status' });
  }
});

/** —— Pro plan config —— */
router.get('/pro-plan', async (_req: AuthRequest, res: Response) => {
  try {
    await ensureProCatalog();
    const plan = await getProPlanConfig();
    res.json({ plan });
  } catch (err) {
    console.error('Admin pro-plan get error:', err);
    res.status(500).json({ error: 'Could not load Pro plan' });
  }
});

router.patch('/pro-plan', async (req: AuthRequest, res: Response) => {
  try {
    await ensureProCatalog();
    const body = req.body as Record<string, unknown>;
    const $set: Record<string, unknown> = {};
    for (const key of [
      'name',
      'monthlyPrice',
      'yearlyPrice',
      'currency',
      'dailyTokens',
      'monthlyLabel',
      'yearlyLabel',
      'description',
      'features',
      'enabled',
      'androidMonthlySku',
      'androidYearlySku',
      'iosMonthlySku',
      'iosYearlySku',
    ]) {
      if (body[key] !== undefined) $set[key] = body[key];
    }
    const plan = await ProPlan.findOneAndUpdate(
      { key: 'default' },
      { $set },
      { new: true },
    );
    res.json({ plan });
  } catch (err) {
    console.error('Admin pro-plan patch error:', err);
    res.status(500).json({ error: 'Could not update Pro plan' });
  }
});

/** —— Theme pack pricing —— */
router.get('/theme-pricing', async (_req: AuthRequest, res: Response) => {
  try {
    await ensureProCatalog();
    const themes = await ThemePackPricing.find().sort({ sortOrder: 1 });
    res.json({ themes });
  } catch (err) {
    console.error('Admin theme-pricing list error:', err);
    res.status(500).json({ error: 'Could not list theme pricing' });
  }
});

router.patch('/theme-pricing/:packId', async (req: AuthRequest, res: Response) => {
  try {
    const packId = paramStr(req.params.packId);
    const body = req.body as Record<string, unknown>;
    const $set: Record<string, unknown> = {};
    for (const key of [
      'name',
      'monthlyPrice',
      'permanentPrice',
      'currency',
      'enabled',
      'sortOrder',
    ]) {
      if (body[key] !== undefined) $set[key] = body[key];
    }
    const theme = await ThemePackPricing.findOneAndUpdate(
      { packId },
      { $set },
      { new: true },
    );
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }
    res.json({ theme });
  } catch (err) {
    console.error('Admin theme-pricing patch error:', err);
    res.status(500).json({ error: 'Could not update theme pricing' });
  }
});

/** Admin grant / revoke Pro for a user */
router.patch('/users/:id/pro', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    const { plan, status, days } = req.body as {
      plan?: 'monthly' | 'yearly' | null;
      status?: 'none' | 'active' | 'expired' | 'cancelled';
      days?: number;
    };
    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (status === 'none' || status === 'cancelled' || status === 'expired') {
      user.proStatus = status;
      if (status === 'none' || status === 'cancelled') {
        user.proPlan = null;
        user.proExpiresAt = null;
      }
    } else {
      const planKey = plan === 'yearly' ? 'yearly' : 'monthly';
      const now = new Date();
      const nDays = Number(days);
      user.proPlan = planKey;
      user.proStatus = 'active';
      user.proExpiresAt = Number.isFinite(nDays) && nDays > 0
        ? new Date(now.getTime() + nDays * 86400000)
        : planKey === 'yearly'
          ? addYears(now, 1)
          : addMonths(now, 1);
      user.proProvider = 'admin';
    }
    await user.save();
    res.json({ user: { id: user.id, email: user.email, pro: entitlementPayload(user) } });
  } catch (err) {
    console.error('Admin grant pro error:', err);
    res.status(500).json({ error: 'Could not update user Pro' });
  }
});

function serializeResetAdmin(doc: InstanceType<typeof PasswordResetRequest>, user?: any) {
  return {
    ...serializeResetForClient(doc),
    deviceId: doc.deviceId,
    lastLoginAtAtRequest: doc.lastLoginAtAtRequest,
    lastLoginDeviceIdAtRequest: doc.lastLoginDeviceIdAtRequest,
    adminNote: doc.adminNote || '',
    user: user
      ? {
          id: user.id || String(user._id),
          name: user.name,
          email: user.email,
          lastLoginAt: user.lastLoginAt || null,
          lastLoginDeviceId: user.lastLoginDeviceId || '',
          lastActiveAt: user.lastActiveAt || null,
          deviceCount: (user.devices || []).length,
          mustChangePassword: !!user.mustChangePassword,
        }
      : null,
    sameDeviceAsLastLogin: !!(
      doc.deviceId &&
      user?.lastLoginDeviceId &&
      doc.deviceId === user.lastLoginDeviceId
    ),
  };
}

/** Password reset support queue */
router.get('/password-resets', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const status = String(req.query.status || '').trim();
    const filter: Record<string, unknown> = {};
    if (status === 'open') {
      filter.status = {
        $in: ['pending', 'awaiting_verification', 'verified', 'temp_password_sent'],
      };
    } else if (status) {
      filter.status = status;
    }

    const rows = await PasswordResetRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('user', 'name email lastLoginAt lastLoginDeviceId lastActiveAt devices mustChangePassword');

    const pendingCount = await PasswordResetRequest.countDocuments({
      status: { $in: ['pending', 'awaiting_verification', 'verified'] },
    });

    res.json({
      pendingCount,
      requests: rows.map(r => serializeResetAdmin(r, r.user)),
    });
  } catch (err) {
    console.error('Admin password-resets list error:', err);
    res.status(500).json({ error: 'Could not list password resets' });
  }
});

router.get('/password-resets/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const doc = await PasswordResetRequest.findById(id).populate(
      'user',
      'name email lastLoginAt lastLoginDeviceId lastActiveAt devices mustChangePassword',
    );
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ request: serializeResetAdmin(doc, doc.user) });
  } catch (err) {
    console.error('Admin password-reset get error:', err);
    res.status(500).json({ error: 'Could not load request' });
  }
});

router.patch('/password-resets/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    const body = req.body as {
      adminNote?: string;
      status?: 'rejected' | 'completed';
      reply?: string;
    };
    const doc = await PasswordResetRequest.findById(id).populate(
      'user',
      'name email lastLoginAt lastLoginDeviceId lastActiveAt devices mustChangePassword',
    );
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (typeof body.adminNote === 'string') {
      doc.adminNote = body.adminNote.trim().slice(0, 2000);
    }
    if (body.status === 'rejected' || body.status === 'completed') {
      doc.status = body.status;
      if (body.status === 'completed') doc.completedAt = new Date();
    }
    const reply = String(body.reply || '').trim();
    if (reply) {
      doc.messages.push({ role: 'admin', message: reply.slice(0, 4000), createdAt: new Date() });
    }
    await doc.save();
    res.json({ request: serializeResetAdmin(doc, doc.user) });
  } catch (err) {
    console.error('Admin password-reset patch error:', err);
    res.status(500).json({ error: 'Could not update request' });
  }
});

/** Same-device (or already verified): generate temp password + deliver as message */
router.post('/password-resets/:id/send-temp-password', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    const doc = await PasswordResetRequest.findById(id).populate(
      'user',
      'name email lastLoginAt lastLoginDeviceId lastActiveAt devices mustChangePassword',
    );
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (['rejected', 'completed'].includes(doc.status)) {
      res.status(400).json({ error: 'Request is closed' });
      return;
    }
    if (!doc.sameDevice && doc.status !== 'verified' && doc.status !== 'temp_password_sent') {
      res.status(400).json({
        error:
          'New device — send OTP/verification link first. Temp password only after verify (or same device).',
      });
      return;
    }

    const temp = await issueTempPasswordForRequest(doc);
    const fresh = await PasswordResetRequest.findById(id).populate(
      'user',
      'name email lastLoginAt lastLoginDeviceId lastActiveAt devices mustChangePassword',
    );

    res.json({
      request: serializeResetAdmin(fresh!, fresh!.user),
      tempPassword: temp,
      message: 'Temporary password generated and added to the user message thread.',
    });
  } catch (err) {
    console.error('Admin send-temp-password error:', err);
    res.status(500).json({ error: 'Could not send temporary password' });
  }
});

/** New-device: create OTP + optional verification token for admin to share */
router.post('/password-resets/:id/send-verification', async (req: AuthRequest, res: Response) => {
  try {
    const id = paramStr(req.params.id);
    const mode = String((req.body as { mode?: string })?.mode || 'both');
    const doc = await PasswordResetRequest.findById(id).populate(
      'user',
      'name email lastLoginAt lastLoginDeviceId lastActiveAt devices mustChangePassword',
    );
    if (!doc) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (['rejected', 'completed', 'temp_password_sent'].includes(doc.status)) {
      res.status(400).json({ error: 'Request is closed or already has a temp password' });
      return;
    }

    const expires = new Date(Date.now() + 30 * 60 * 1000);
    let otp: string | undefined;
    let verificationToken: string | undefined;

    if (mode === 'otp' || mode === 'both') {
      otp = generateOtp();
      doc.otpHash = await hashSecret(otp);
      doc.otpExpiresAt = expires;
    }
    if (mode === 'link' || mode === 'both') {
      verificationToken = generateVerificationToken();
      doc.verificationTokenHash = await hashSecret(verificationToken);
      doc.verificationExpiresAt = expires;
    }

    doc.status = 'awaiting_verification';
    const code = resetRequestCode(doc.id);
    const parts = [
      `Verification for ${code} (expires in 30 min).`,
      otp ? `OTP: ${otp}` : null,
      verificationToken ? `Link token: ${verificationToken}` : null,
      'User enters this in the app under Forgot password → Verify.',
    ].filter(Boolean);
    doc.messages.push({
      role: 'admin',
      message: parts.join('\n'),
      createdAt: new Date(),
    });
    await doc.save();

    try {
      const uid =
        doc.user && typeof doc.user === 'object' && '_id' in (doc.user as object)
          ? String((doc.user as { _id: unknown })._id)
          : String(doc.user);
      await sendPushToUser(uid, {
        title: 'Password reset verification',
        body: otp
          ? `Your Expenso verification OTP is ${otp}`
          : 'Open Expenso → Forgot password to enter your verification token.',
        data: { type: 'password_reset', requestId: String(doc._id) },
      });
    } catch {
      /* ignore */
    }

    res.json({
      request: serializeResetAdmin(doc, doc.user),
      otp: otp || null,
      verificationToken: verificationToken || null,
      expiresAt: expires,
      message: 'Verification created. Share OTP/token with the user (also pushed if they have FCM).',
    });
  } catch (err) {
    console.error('Admin send-verification error:', err);
    res.status(500).json({ error: 'Could not create verification' });
  }
});

export default router;
