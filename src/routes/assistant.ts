import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { runAssistantChat, runPreciseAnswer } from '../services/assistant/engine';
import { AssistantIntent } from '../models/AssistantIntent';
import { getTokenUsage } from '../services/assistant/usage';
import {
  cleanupAssistantMisses,
  expandPatternsFromMisses,
  logLearning,
} from '../services/assistant/maintenance';
import { User } from '../models/User';
import { isProActive } from '../services/proEntitlements';
import { MonthlyBudgetsInput, normalizeMonthlyBudgets } from '../services/monthlyBudgets';

const router = Router();

async function requireAskPro(req: AuthRequest, res: Response): Promise<boolean> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return false;
  }
  const user = await User.findById(userId)
    .select('proPlan proStatus proExpiresAt')
    .lean();
  if (!user || !isProActive(user)) {
    res.status(403).json({
      error: 'Expenso Pro is required for Ask AI',
      code: 'PRO_REQUIRED',
    });
    return false;
  }
  return true;
}

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

function normalizeExpenses(expenses?: BodyExpense[]) {
  return (expenses || [])
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
}

function normalizeHistory(history?: { role?: string; text?: string; intent?: string }[]) {
  return (history || [])
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && h.text)
    .map(h => ({
      role: h.role as 'user' | 'assistant',
      text: String(h.text),
      intent: h.intent,
    }));
}

router.post('/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await requireAskPro(req, res))) return;

    const {
      message,
      expenses,
      monthlyBudget,
      monthlyBudgets,
      repeatMonthlyBudget,
      isJoint,
      inputMode,
      history,
      lastIntent,
      lang,
      chipContext,
      clientToday,
      timezoneOffsetMinutes,
    } = req.body as {
      message?: string;
      expenses?: BodyExpense[];
      monthlyBudget?: number;
      monthlyBudgets?: MonthlyBudgetsInput;
      repeatMonthlyBudget?: boolean;
      isJoint?: boolean;
      inputMode?: 'keyboard' | 'chip';
      history?: { role?: string; text?: string; intent?: string }[];
      lastIntent?: string;
      lang?: 'en' | 'hi';
      clientToday?: string;
      timezoneOffsetMinutes?: number;
      chipContext?: {
        afterReply?: string;
        afterIntent?: string;
        chipsShown?: string[];
      };
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const normalized = normalizeExpenses(expenses);
    const hist = normalizeHistory(history);

    const mode: 'chip' | 'keyboard' = inputMode === 'chip' ? 'chip' : 'keyboard';
    const assistantInput = {
      message: message.trim(),
      userId: req.user?.userId,
      expenses: normalized,
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : 0,
      monthlyBudgets: normalizeMonthlyBudgets(monthlyBudgets),
      repeatMonthlyBudget: repeatMonthlyBudget === true,
      isJoint: !!isJoint,
      inputMode: mode,
      history: hist,
      lastIntent: typeof lastIntent === 'string' ? lastIntent : undefined,
      lang: lang === 'hi' || lang === 'en' ? lang : undefined,
      clientToday:
        typeof clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
          ? clientToday
          : undefined,
      timezoneOffsetMinutes:
        typeof timezoneOffsetMinutes === 'number' &&
        Number.isFinite(timezoneOffsetMinutes) &&
        Math.abs(timezoneOffsetMinutes) <= 840
          ? timezoneOffsetMinutes
          : undefined,
    };
    const result = await runAssistantChat(assistantInput);

    if (mode === 'chip') {
      const lastAssistant = [...hist].reverse().find(h => h.role === 'assistant');
      const afterReply =
        (typeof chipContext?.afterReply === 'string' && chipContext.afterReply.trim()) ||
        lastAssistant?.text ||
        '';
      const afterIntent =
        (typeof chipContext?.afterIntent === 'string' && chipContext.afterIntent) ||
        lastAssistant?.intent ||
        (typeof lastIntent === 'string' ? lastIntent : '') ||
        '';
      const chipsShown = Array.isArray(chipContext?.chipsShown)
        ? chipContext!.chipsShown.filter(c => typeof c === 'string' && c.trim()).slice(0, 12)
        : undefined;

      logLearning([
        {
          intentKey: result.intent || 'unknown',
          intentName: result.intent || 'unknown',
          pattern: message.trim(),
          source: 'chip_click',
          fromMessage: afterReply || undefined,
          afterIntent: afterIntent || undefined,
          chipsShown,
        },
      ]).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    console.error('Assistant chat error:', err);
    res.status(500).json({ error: 'Could not process message' });
  }
});

/**
 * “Need a more accurate answer” — LLM with stats + recent expense ledger.
 * Client must not show that raw data was attached; only display `reply`.
 */
router.post('/precise', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await requireAskPro(req, res))) return;

    const {
      message,
      previousReply,
      expenses,
      monthlyBudget,
      monthlyBudgets,
      repeatMonthlyBudget,
      isJoint,
      history,
      lang,
      clientToday,
      timezoneOffsetMinutes,
    } = req.body as {
      message?: string;
      previousReply?: string;
      expenses?: BodyExpense[];
      monthlyBudget?: number;
      monthlyBudgets?: MonthlyBudgetsInput;
      repeatMonthlyBudget?: boolean;
      isJoint?: boolean;
      history?: { role?: string; text?: string; intent?: string }[];
      lang?: 'en' | 'hi';
      clientToday?: string;
      timezoneOffsetMinutes?: number;
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const assistantInput = {
      message: message.trim(),
      previousReply: typeof previousReply === 'string' ? previousReply : undefined,
      userId: req.user?.userId,
      expenses: normalizeExpenses(expenses),
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : 0,
      monthlyBudgets: normalizeMonthlyBudgets(monthlyBudgets),
      repeatMonthlyBudget: repeatMonthlyBudget === true,
      isJoint: !!isJoint,
      history: normalizeHistory(history),
      lang: lang === 'hi' || lang === 'en' ? lang : undefined,
      clientToday:
        typeof clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
          ? clientToday
          : undefined,
      timezoneOffsetMinutes:
        typeof timezoneOffsetMinutes === 'number' &&
        Number.isFinite(timezoneOffsetMinutes) &&
        Math.abs(timezoneOffsetMinutes) <= 840
          ? timezoneOffsetMinutes
          : undefined,
    };
    const result = await runPreciseAnswer(assistantInput);

    res.json(result);
  } catch (err) {
    console.error('Assistant precise error:', err);
    res.status(500).json({ error: 'Could not get precise answer' });
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
