import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { Feedback } from '../models/Feedback';

const router = Router();

const CATEGORIES = new Set(['bug', 'idea', 'praise', 'other']);

router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (message.length < 5) {
      res.status(400).json({ error: 'Please write at least a few words of feedback' });
      return;
    }
    if (message.length > 2000) {
      res.status(400).json({ error: 'Feedback is too long (max 2000 characters)' });
      return;
    }

    const categoryRaw = String(req.body?.category || 'other').toLowerCase();
    const category = CATEGORIES.has(categoryRaw) ? categoryRaw : 'other';
    const platform = String(req.body?.platform || '').slice(0, 40);

    const doc = await Feedback.create({
      user: req.user!.userId,
      message,
      category,
      platform,
    });

    res.status(201).json({
      feedback: {
        id: doc.id,
        message: doc.message,
        category: doc.category,
        status: doc.status,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    console.error('Create feedback error:', err);
    res.status(500).json({ error: 'Could not send feedback' });
  }
});

router.get('/mine', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const items = await Feedback.find({ user: req.user!.userId })
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({
      feedback: items.map(d => ({
        id: d.id,
        message: d.message,
        category: d.category,
        status: d.status,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    console.error('List feedback error:', err);
    res.status(500).json({ error: 'Could not load feedback' });
  }
});

export default router;
