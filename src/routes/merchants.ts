import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { GlobalMerchant } from '../models/Merchant';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { merchantUploadDir } from '../services/merchantSeed';

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
      .slice(0, 40) || 'merchant'
  );
}

function publicBase(req: AuthRequest): string {
  const env = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  if (env) return env;
  const host = req.get('host') || `localhost:${process.env.PORT || 4000}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function absoluteIcon(req: AuthRequest, iconUrl: string): string {
  if (!iconUrl) return '';
  if (/^https?:\/\//i.test(iconUrl)) return iconUrl;
  if (iconUrl.startsWith('/')) return `${publicBase(req)}${iconUrl}`;
  return iconUrl;
}

function toPublic(req: AuthRequest, m: any) {
  return {
    id: m.slug,
    label: m.label,
    keywords: m.keywords || [],
    category: m.category,
    color: m.color,
    bgColor: m.bgColor,
    iconLetter: m.iconLetter,
    iconUrl: absoluteIcon(req, m.iconUrl || ''),
    domain: m.domain || '',
    active: m.active,
    sortOrder: m.sortOrder,
  };
}

/** App: list active merchants (auth optional for future; require login like categories) */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await GlobalMerchant.find({ active: true }).sort({ sortOrder: 1, label: 1 }).lean();
    res.json({ merchants: list.map(m => toPublic(req, m)) });
  } catch (err) {
    console.error('Merchants list error:', err);
    res.status(500).json({ error: 'Could not load merchants' });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = merchantUploadDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 1.5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)$/i.test(file.mimetype)) {
      cb(new Error('Only image uploads allowed (png/jpg/webp/gif/ico)'));
      return;
    }
    cb(null, true);
  },
});

/** Admin routes mounted under /api/admin/merchants via separate registration —
 *  keep admin handlers here and export adminRouter for clarity.
 */
export const merchantsPublicRouter = router;

export const merchantsAdminRouter = Router();
merchantsAdminRouter.use(requireAuth, requireAdmin);

merchantsAdminRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const list = await GlobalMerchant.find().sort({ sortOrder: 1, label: 1 }).lean();
    res.json({
      merchants: list.map(m => ({
        ...toPublic(req, m),
        _id: String(m._id),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    });
  } catch (err) {
    console.error('Admin merchants error:', err);
    res.status(500).json({ error: 'Could not load merchants' });
  }
});

merchantsAdminRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      label,
      slug: rawSlug,
      keywords,
      category,
      color,
      bgColor,
      iconLetter,
      iconUrl,
      domain,
      sortOrder,
      active,
    } = req.body as Record<string, unknown>;

    if (!label || typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'Label is required' });
      return;
    }
    const slug =
      (typeof rawSlug === 'string' && rawSlug.trim() && slugify(rawSlug)) || slugify(label);
    const exists = await GlobalMerchant.findOne({ slug });
    if (exists) {
      res.status(409).json({ error: 'Merchant slug already exists' });
      return;
    }
    const doc = await GlobalMerchant.create({
      slug,
      label: label.trim(),
      keywords: Array.isArray(keywords)
        ? keywords.map(String).map(s => s.trim().toLowerCase()).filter(Boolean)
        : String(keywords || '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean),
      category: typeof category === 'string' && category ? category : 'other',
      color: typeof color === 'string' ? color : '#A0A0B8',
      bgColor: typeof bgColor === 'string' ? bgColor : '#252538',
      iconLetter: typeof iconLetter === 'string' && iconLetter ? iconLetter.slice(0, 3) : label[0],
      iconUrl: typeof iconUrl === 'string' ? iconUrl.trim() : '',
      domain: typeof domain === 'string' ? domain.trim().toLowerCase() : '',
      sortOrder: typeof sortOrder === 'number' ? sortOrder : 200,
      active: active !== false,
    });
    res.status(201).json({ merchant: toPublic(req, doc) });
  } catch (err: any) {
    console.error('Admin create merchant error:', err);
    res.status(500).json({ error: err?.message || 'Could not create merchant' });
  }
});

merchantsAdminRouter.patch('/:slug', async (req: AuthRequest, res: Response) => {
  try {
    const slug = paramStr(req.params.slug);
    const doc = await GlobalMerchant.findOne({ slug });
    if (!doc) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (typeof body.label === 'string' && body.label.trim()) doc.label = body.label.trim();
    if (Array.isArray(body.keywords)) {
      doc.keywords = body.keywords.map(String).map(s => s.trim().toLowerCase()).filter(Boolean);
    } else if (typeof body.keywords === 'string') {
      doc.keywords = body.keywords
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
    }
    if (typeof body.category === 'string') doc.category = body.category;
    if (typeof body.color === 'string') doc.color = body.color;
    if (typeof body.bgColor === 'string') doc.bgColor = body.bgColor;
    if (typeof body.iconLetter === 'string') doc.iconLetter = body.iconLetter.slice(0, 3);
    if (typeof body.iconUrl === 'string') doc.iconUrl = body.iconUrl.trim();
    if (typeof body.domain === 'string') doc.domain = body.domain.trim().toLowerCase();
    if (typeof body.sortOrder === 'number') doc.sortOrder = body.sortOrder;
    if (typeof body.active === 'boolean') doc.active = body.active;
    await doc.save();
    res.json({ merchant: toPublic(req, doc) });
  } catch (err) {
    console.error('Admin patch merchant error:', err);
    res.status(500).json({ error: 'Could not update merchant' });
  }
});

merchantsAdminRouter.delete('/:slug', async (req: AuthRequest, res: Response) => {
  try {
    const slug = paramStr(req.params.slug);
    const doc = await GlobalMerchant.findOneAndDelete({ slug });
    if (!doc) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }
    if (doc.iconUrl?.startsWith('/uploads/merchants/')) {
      const file = path.join(process.cwd(), doc.iconUrl.replace(/^\//, ''));
      fs.unlink(file, () => {});
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete merchant error:', err);
    res.status(500).json({ error: 'Could not delete merchant' });
  }
});

merchantsAdminRouter.post(
  '/:slug/icon',
  (req, res, next) => {
    upload.single('icon')(req, res, err => {
      if (err) {
        res.status(400).json({ error: err.message || 'Upload failed' });
        return;
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = paramStr(req.params.slug);
      const doc = await GlobalMerchant.findOne({ slug });
      if (!doc) {
        res.status(404).json({ error: 'Merchant not found' });
        return;
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ error: 'No icon file uploaded (field name: icon)' });
        return;
      }
      if (doc.iconUrl?.startsWith('/uploads/merchants/')) {
        const prev = path.join(process.cwd(), doc.iconUrl.replace(/^\//, ''));
        fs.unlink(prev, () => {});
      }
      doc.iconUrl = `/uploads/merchants/${file.filename}`;
      await doc.save();
      res.json({ merchant: toPublic(req, doc) });
    } catch (err) {
      console.error('Admin icon upload error:', err);
      res.status(500).json({ error: 'Could not upload icon' });
    }
  },
);

/** Re-fetch logo from domain into local uploads */
merchantsAdminRouter.post('/:slug/refresh-icon', async (req: AuthRequest, res: Response) => {
  try {
    const slug = paramStr(req.params.slug);
    const doc = await GlobalMerchant.findOne({ slug });
    if (!doc) {
      res.status(404).json({ error: 'Merchant not found' });
      return;
    }
    const domain =
      (typeof req.body?.domain === 'string' && req.body.domain.trim()) || doc.domain;
    if (!domain) {
      res.status(400).json({ error: 'Set a website domain first (e.g. swiggy.com)' });
      return;
    }
    doc.domain = domain.toLowerCase();

    const sources = [
      `https://logo.clearbit.com/${doc.domain}`,
      `https://www.google.com/s2/favicons?domain=${doc.domain}&sz=128`,
      `https://icons.duckduckgo.com/ip3/${doc.domain}.ico`,
    ];
    let saved = false;
    const dir = merchantUploadDir();
    fs.mkdirSync(dir, { recursive: true });

    for (const url of sources) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'ExpensoLogoSeed/1.0' },
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) continue;
        const ctype = (r.headers.get('content-type') || '').toLowerCase();
        if (ctype.includes('svg')) continue;
        const ab = await r.arrayBuffer();
        if (!ab.byteLength || ab.byteLength < 80) continue;
        let ext = 'png';
        if (ctype.includes('jpeg') || ctype.includes('jpg')) ext = 'jpg';
        else if (ctype.includes('webp')) ext = 'webp';
        else if (ctype.includes('ico')) ext = 'ico';
        const fileName = `${doc.slug}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(dir, fileName), Buffer.from(ab));
        if (doc.iconUrl?.startsWith('/uploads/merchants/')) {
          fs.unlink(path.join(process.cwd(), doc.iconUrl.replace(/^\//, '')), () => {});
        }
        doc.iconUrl = `/uploads/merchants/${fileName}`;
        await doc.save();
        saved = true;
        break;
      } catch {
        // next
      }
    }

    if (!saved) {
      res.status(502).json({ error: 'Could not download a logo for that domain' });
      return;
    }
    res.json({ merchant: toPublic(req, doc) });
  } catch (err) {
    console.error('Refresh icon error:', err);
    res.status(500).json({ error: 'Could not refresh icon' });
  }
});
