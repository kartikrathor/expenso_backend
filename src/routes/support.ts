import { Router, Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { SupportTicket } from '../models/SupportTicket';
import { User } from '../models/User';

const router = Router();

const CATEGORIES = new Set(['bug', 'account', 'billing', 'feature', 'other']);

function ticketCode(id: string): string {
  return `EXP-${String(id).slice(-6).toUpperCase()}`;
}

function previewOf(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

function serializeTicket(doc: InstanceType<typeof SupportTicket>) {
  const lastReply = (doc.replies || [])[(doc.replies || []).length - 1];
  const unreadByUser =
    typeof doc.unreadByUser === 'boolean'
      ? doc.unreadByUser
      : lastReply?.role === 'admin';

  return {
    id: doc.id,
    code: ticketCode(doc.id),
    subject: doc.subject,
    body: doc.body,
    category: doc.category,
    status: doc.status,
    platform: doc.platform,
    replies: (doc.replies || []).map(r => ({
      role: r.role,
      message: r.message,
      authorName: r.authorName,
      createdAt: r.createdAt,
    })),
    unread: !!unreadByUser,
    unreadByUser: !!unreadByUser,
    lastMessageAt: doc.lastMessageAt || doc.updatedAt,
    lastMessageRole: doc.lastMessageRole || lastReply?.role || 'user',
    lastMessagePreview: doc.lastMessagePreview || previewOf(lastReply?.message || doc.body),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    resolvedAt: doc.resolvedAt || null,
  };
}

router.post('/tickets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    if (subject.length < 3) {
      res.status(400).json({ error: 'Subject is required' });
      return;
    }
    if (body.length < 10) {
      res.status(400).json({ error: 'Please describe the issue in a bit more detail' });
      return;
    }
    if (subject.length > 120 || body.length > 4000) {
      res.status(400).json({ error: 'Subject or message is too long' });
      return;
    }

    const categoryRaw = String(req.body?.category || 'other').toLowerCase();
    const category = CATEGORIES.has(categoryRaw) ? categoryRaw : 'other';
    const platform = String(req.body?.platform || '').slice(0, 40);

    const user = await User.findById(req.user!.userId).select('name');
    const now = new Date();
    const doc = await SupportTicket.create({
      user: req.user!.userId,
      subject,
      body,
      category,
      platform,
      unreadByAdmin: true,
      unreadByUser: false,
      lastMessageAt: now,
      lastMessageRole: 'user',
      lastMessagePreview: previewOf(body),
      replies: [
        {
          role: 'user',
          message: body,
          authorName: user?.name || 'You',
          createdAt: now,
        },
      ],
    });

    res.status(201).json({ ticket: serializeTicket(doc) });
  } catch (err) {
    console.error('Create ticket error:', err);
    res.status(500).json({ error: 'Could not create support ticket' });
  }
});

router.get('/tickets', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 30);
    const items = await SupportTicket.find({ user: req.user!.userId })
      .sort({ unreadByUser: -1, lastMessageAt: -1, updatedAt: -1 })
      .limit(limit);
    const unreadCount = await SupportTicket.countDocuments({
      user: req.user!.userId,
      unreadByUser: true,
    });
    res.json({
      tickets: items.map(serializeTicket),
      unreadCount,
    });
  } catch (err) {
    console.error('List tickets error:', err);
    res.status(500).json({ error: 'Could not load tickets' });
  }
});

router.get('/tickets/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid ticket id' });
      return;
    }
    const doc = await SupportTicket.findOne({ _id: id, user: req.user!.userId });
    if (!doc) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json({ ticket: serializeTicket(doc) });
  } catch (err) {
    console.error('Get ticket error:', err);
    res.status(500).json({ error: 'Could not load ticket' });
  }
});

/** Mark ticket as read for the user (admin replies cleared). */
router.post('/tickets/:id/read', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid ticket id' });
      return;
    }
    const doc = await SupportTicket.findOneAndUpdate(
      { _id: id, user: req.user!.userId },
      { $set: { unreadByUser: false } },
      { new: true },
    );
    if (!doc) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json({ ticket: serializeTicket(doc) });
  } catch (err) {
    console.error('Mark ticket read error:', err);
    res.status(500).json({ error: 'Could not mark as read' });
  }
});

/** User follow-up on an open ticket */
router.post('/tickets/:id/replies', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || '');
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid ticket id' });
      return;
    }
    const message = String(req.body?.message || '').trim();
    if (message.length < 2 || message.length > 4000) {
      res.status(400).json({ error: 'Reply must be 2–4000 characters' });
      return;
    }

    const doc = await SupportTicket.findOne({ _id: id, user: req.user!.userId });
    if (!doc) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (doc.status === 'closed') {
      res.status(400).json({ error: 'This ticket is closed' });
      return;
    }

    const user = await User.findById(req.user!.userId).select('name');
    const now = new Date();
    doc.replies.push({
      role: 'user',
      message,
      authorName: user?.name || 'You',
      createdAt: now,
    });
    doc.unreadByAdmin = true;
    doc.unreadByUser = false;
    doc.lastMessageAt = now;
    doc.lastMessageRole = 'user';
    doc.lastMessagePreview = previewOf(message);
    if (doc.status === 'resolved') {
      doc.status = 'open';
      doc.resolvedAt = undefined;
    }
    await doc.save();
    res.json({ ticket: serializeTicket(doc) });
  } catch (err) {
    console.error('Reply ticket error:', err);
    res.status(500).json({ error: 'Could not send reply' });
  }
});

export default router;
