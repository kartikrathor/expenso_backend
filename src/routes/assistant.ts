import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { runAssistantChat } from '../services/assistant/engine';
import { AssistantIntent } from '../models/AssistantIntent';
import { getTokenUsage } from '../services/assistant/usage';
import {
  cleanupAssistantMisses,
  expandPatternsFromMisses,
} from '../services/assistant/maintenance';

const router = Router();

type BodyExpense = {
  amount?: number;
  merchantLabel?: string;
  category?: string;
  note?: string;
  date?: string;
  createdById?: string;
  createdByName?: string;
  paidById?: string;
  paidByName?: string;
  groupId?: string;
  groupName?: string;
};

router.post('/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { message, expenses, monthlyBudget, isJoint, inputMode, history, lastIntent, lang } =
      req.body as {
        message?: string;
        expenses?: BodyExpense[];
        monthlyBudget?: number;
        isJoint?: boolean;
        inputMode?: 'keyboard' | 'chip';
        history?: { role?: string; text?: string; intent?: string }[];
        lastIntent?: string;
        lang?: 'en' | 'hi';
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
        createdById: e.createdById,
        createdByName: e.createdByName,
        paidById: e.paidById,
        paidByName: e.paidByName,
        groupId: e.groupId,
        groupName: e.groupName,
      }));

    const hist = (history || [])
      .filter(h => h && (h.role === 'user' || h.role === 'assistant') && h.text)
      .map(h => ({
        role: h.role as 'user' | 'assistant',
        text: String(h.text),
        intent: h.intent,
      }));

    const result = await runAssistantChat({
      message: message.trim(),
      userId: req.user?.userId,
      expenses: normalized,
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : 0,
      isJoint: !!isJoint,
      inputMode: inputMode === 'chip' ? 'chip' : 'keyboard',
      history: hist,
      lastIntent: typeof lastIntent === 'string' ? lastIntent : undefined,
      lang: lang === 'hi' || lang === 'en' ? lang : undefined,
    });

    res.json(result);
  } catch (err) {
    console.error('Assistant chat error:', err);
    res.status(500).json({ error: 'Could not process message' });
  }
});

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

router.get('/usage', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const usage = await getTokenUsage(req.user!.userId);
    res.json(usage);
  } catch (err) {
    console.error('Assistant usage error:', err);
    res.status(500).json({ error: 'Could not load usage' });
  }
});

/** Manual trigger (protected by same auth — useful while testing) */
router.post('/maintain', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const cleaned = await cleanupAssistantMisses();
    const expanded = await expandPatternsFromMisses();
    res.json({ cleaned, expanded });
  } catch (err: any) {
    console.error('Assistant maintain error:', err);
    res.status(500).json({ error: err?.message || 'Maintenance failed' });
  }
});

export default router;
