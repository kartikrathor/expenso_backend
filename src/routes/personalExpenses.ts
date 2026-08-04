import { Router, Response } from 'express';
import { PersonalExpense } from '../models/PersonalExpense';
import { User } from '../models/User';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { recordCategoryCorrection } from '../services/categoryLearning';

const router = Router();

function normalizeCategory(category?: string): string {
  const c = (category || 'other').trim().toLowerCase().slice(0, 40);
  return c || 'other';
}

function normalizeClientId(clientId?: string): string | undefined {
  const value = clientId?.trim().slice(0, 120);
  return value || undefined;
}

function exactDuplicateKey(expense: {
  amount: number;
  merchantLabel: string;
  merchant: string;
  category: string;
  note: string;
  date: Date;
  inputMethod: string;
}): string {
  return JSON.stringify([
    Number(expense.amount),
    expense.merchantLabel.trim().toLowerCase(),
    expense.merchant.trim().toLowerCase(),
    expense.category.trim().toLowerCase(),
    expense.note.trim(),
    expense.date.toISOString(),
    expense.inputMethod,
  ]);
}

/** List personal expenses for the signed-in user */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const expenses = await PersonalExpense.find({ user: userId })
      .sort({ date: -1 })
      .limit(2000);
    res.json({ expenses });
  } catch (err) {
    console.error('List personal expenses error:', err);
    res.status(500).json({ error: 'Could not list expenses' });
  }
});

/** Personal monthly budget (stored on User) */
router.get('/budget', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.userId).select('monthlyBudget');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ monthlyBudget: user.monthlyBudget ?? 0 });
  } catch (err) {
    console.error('Get personal budget error:', err);
    res.status(500).json({ error: 'Could not get budget' });
  }
});

router.patch('/budget', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const amount = Number((req.body as { monthlyBudget?: number }).monthlyBudget);
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: 'monthlyBudget must be a non-negative number' });
      return;
    }
    const user = await User.findByIdAndUpdate(
      req.user!.userId,
      { monthlyBudget: amount },
      { new: true },
    ).select('monthlyBudget');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ monthlyBudget: user.monthlyBudget ?? 0 });
  } catch (err) {
    console.error('Set personal budget error:', err);
    res.status(500).json({ error: 'Could not set budget' });
  }
});

/** Remove historical exact copies created by request retries or old cache migration. */
router.post('/dedupe', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const expenses = await PersonalExpense.find({ user: userId }).sort({ createdAt: 1 });
    const seen = new Set<string>();
    const duplicateIds = [];

    for (const expense of expenses) {
      const key = exactDuplicateKey(expense);
      if (seen.has(key)) duplicateIds.push(expense._id);
      else seen.add(key);
    }

    if (duplicateIds.length > 0) {
      await PersonalExpense.deleteMany({ user: userId, _id: { $in: duplicateIds } });
    }
    res.json({ removed: duplicateIds.length });
  } catch (err) {
    console.error('Dedupe personal expenses error:', err);
    res.status(500).json({ error: 'Could not clean duplicate expenses' });
  }
});

/** Create personal expense */
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { amount, merchantLabel, merchant, category, note, date, inputMethod, clientId } = req.body as {
      amount?: number;
      merchantLabel?: string;
      merchant?: string;
      category?: string;
      note?: string;
      date?: string;
      inputMethod?: 'voice' | 'manual';
      clientId?: string;
    };

    if (!amount || amount <= 0 || !merchantLabel?.trim()) {
      res.status(400).json({ error: 'amount and merchantLabel are required' });
      return;
    }

    const createData = {
      ...(normalizeClientId(clientId) ? { clientId: normalizeClientId(clientId) } : {}),
      amount,
      merchantLabel: merchantLabel.trim(),
      merchant: merchant?.trim() || 'default',
      category: normalizeCategory(category),
      note: note?.trim() || '',
      date: date ? new Date(date) : new Date(),
      inputMethod: inputMethod === 'voice' ? 'voice' : 'manual',
    };
    const stableClientId = normalizeClientId(clientId);
    const expense = stableClientId
      ? await PersonalExpense.findOneAndUpdate(
          { user: userId, clientId: stableClientId },
          { $setOnInsert: { user: userId, ...createData } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
      : await PersonalExpense.create({ user: userId, ...createData });

    res.status(201).json({ expense });
  } catch (err) {
    console.error('Create personal expense error:', err);
    res.status(500).json({ error: 'Could not create expense' });
  }
});

/** Update personal expense */
router.patch('/:expenseId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const expense = await PersonalExpense.findOne({
      _id: req.params.expenseId,
      user: userId,
    });
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    const { amount, merchantLabel, merchant, category, note, date, inputMethod } = req.body as {
      amount?: number;
      merchantLabel?: string;
      merchant?: string;
      category?: string;
      note?: string;
      date?: string;
      inputMethod?: 'voice' | 'manual';
    };

    if (amount !== undefined) {
      if (amount <= 0) {
        res.status(400).json({ error: 'amount must be greater than 0' });
        return;
      }
      expense.amount = amount;
    }
    if (merchantLabel !== undefined) expense.merchantLabel = merchantLabel.trim();
    if (merchant !== undefined) expense.merchant = merchant.trim() || 'default';
    if (category !== undefined) {
      const prevCat = expense.category;
      const nextCat = normalizeCategory(category);
      expense.category = nextCat as typeof expense.category;
      if (prevCat !== nextCat) {
        void recordCategoryCorrection({
          userId,
          fromCategory: prevCat,
          toCategory: nextCat,
          merchantLabel: expense.merchantLabel,
          note: expense.note,
        }).catch(() => {});
      }
    }
    if (note !== undefined) expense.note = note.trim();
    if (date !== undefined) expense.date = new Date(date);
    if (inputMethod === 'voice' || inputMethod === 'manual') expense.inputMethod = inputMethod;

    await expense.save();
    res.json({ expense });
  } catch (err) {
    console.error('Update personal expense error:', err);
    res.status(500).json({ error: 'Could not update expense' });
  }
});

/** Delete personal expense */
router.delete('/:expenseId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const deleted = await PersonalExpense.findOneAndDelete({
      _id: req.params.expenseId,
      user: userId,
    });
    // DELETE is intentionally idempotent: a retry after a lost response must
    // still succeed instead of leaving the client stuck with a stale row.
    res.json({ message: 'Deleted', alreadyDeleted: !deleted });
  } catch (err) {
    console.error('Delete personal expense error:', err);
    res.status(500).json({ error: 'Could not delete expense' });
  }
});

export default router;
