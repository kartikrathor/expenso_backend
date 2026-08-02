import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { runAssistantChat } from '../services/assistant/engine';
import { AssistantIntent } from '../models/AssistantIntent';

const router = Router();

type BodyExpense = {
  amount?: number;
  merchantLabel?: string;
  category?: string;
  note?: string;
  date?: string;
};

/** Chat with keyword assistant — uses client household snapshot for accuracy */
router.post('/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { message, expenses, monthlyBudget, isJoint } = req.body as {
      message?: string;
      expenses?: BodyExpense[];
      monthlyBudget?: number;
      isJoint?: boolean;
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const normalized = (expenses || [])
      .filter(e => e && typeof e.amount === 'number' && e.amount > 0)
      .map(e => ({
        amount: e.amount!,
        merchantLabel: (e.merchantLabel || 'Unknown').trim(),
        category: e.category || 'other',
        note: e.note || '',
        date: e.date || new Date().toISOString(),
      }));

    const result = await runAssistantChat({
      message: message.trim(),
      userId: req.user?.userId,
      expenses: normalized,
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : 0,
      isJoint: !!isJoint,
    });

    res.json(result);
  } catch (err) {
    console.error('Assistant chat error:', err);
    res.status(500).json({ error: 'Could not process message' });
  }
});

/** Quick suggestion chips for the UI */
router.get('/suggestions', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const intents = await AssistantIntent.find({ active: true })
      .select('key chips')
      .lean();
    const chips = new Set<string>();
    intents.forEach(i => (i.chips || []).forEach(c => chips.add(c)));
    const list = [...chips].slice(0, 8);
    res.json({
      chips: list.length
        ? list
        : [
            'Is month kitna kharch?',
            'Budget bacha?',
            'Top category',
            'Aaj kitna?',
          ],
    });
  } catch (err) {
    console.error('Assistant suggestions error:', err);
    res.status(500).json({ error: 'Could not load suggestions' });
  }
});

export default router;
