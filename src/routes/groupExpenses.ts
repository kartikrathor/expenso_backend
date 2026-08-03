import { Router, Response } from 'express';
import { Group } from '../models/Group';
import { GroupExpense } from '../models/GroupExpense';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { recordCategoryCorrection } from '../services/categoryLearning';

const router = Router({ mergeParams: true });

async function assertMember(groupId: string, userId: string) {
  const group = await Group.findById(groupId);
  if (!group) return { error: 'Group not found', status: 404 as const };
  const ok = group.members.some(m => m.user.toString() === userId);
  if (!ok) return { error: 'Not a member of this group', status: 403 as const };
  return { group };
}

/** List shared expenses in a group */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = req.params.groupId as string;
    const check = await assertMember(groupId, req.user!.userId);
    if ('error' in check && check.error) {
      res.status(check.status!).json({ error: check.error });
      return;
    }

    const expenses = await GroupExpense.find({ group: groupId })
      .populate('paidBy', 'name email avatarColor')
      .populate('createdBy', 'name')
      .sort({ date: -1 })
      .limit(200);

    res.json({ expenses });
  } catch (err) {
    console.error('List group expenses error:', err);
    res.status(500).json({ error: 'Could not list expenses' });
  }
});

/** Add shared expense */
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = req.params.groupId as string;
    const userId = req.user!.userId;
    const check = await assertMember(groupId, userId);
    if ('error' in check && check.error) {
      res.status(check.status!).json({ error: check.error });
      return;
    }

    const { amount, merchantLabel, category, note, date, paidBy, splitAmong } = req.body as {
      amount?: number;
      merchantLabel?: string;
      category?: string;
      note?: string;
      date?: string;
      paidBy?: string;
      splitAmong?: string[];
    };

    if (!amount || amount <= 0 || !merchantLabel?.trim()) {
      res.status(400).json({ error: 'amount and merchantLabel are required' });
      return;
    }

    const expense = await GroupExpense.create({
      group: groupId,
      amount,
      merchantLabel: merchantLabel.trim(),
      category: category || 'other',
      note: note?.trim() || '',
      date: date ? new Date(date) : new Date(),
      paidBy: paidBy || userId,
      splitAmong: splitAmong || [],
      createdBy: userId,
    });

    const populated = await GroupExpense.findById(expense.id)
      .populate('paidBy', 'name email avatarColor')
      .populate('createdBy', 'name');

    res.status(201).json({ expense: populated });
  } catch (err) {
    console.error('Create group expense error:', err);
    res.status(500).json({ error: 'Could not create expense' });
  }
});

/** Update shared expense */
router.patch('/:expenseId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = req.params.groupId as string;
    const userId = req.user!.userId;
    const check = await assertMember(groupId, userId);
    if ('error' in check && check.error) {
      res.status(check.status!).json({ error: check.error });
      return;
    }

    const expense = await GroupExpense.findOne({ _id: req.params.expenseId, group: groupId });
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    const { amount, merchantLabel, category, note, date } = req.body as {
      amount?: number;
      merchantLabel?: string;
      category?: string;
      note?: string;
      date?: string;
    };

    if (amount !== undefined) {
      if (amount <= 0) {
        res.status(400).json({ error: 'amount must be greater than 0' });
        return;
      }
      expense.amount = amount;
    }
    if (merchantLabel !== undefined) expense.merchantLabel = merchantLabel.trim();
    if (category !== undefined) {
      const prevCat = String(expense.category || 'other').toLowerCase();
      const nextCat = String(category || 'other').trim().toLowerCase().slice(0, 40) || 'other';
      expense.category = nextCat as any;
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

    await expense.save();

    const populated = await GroupExpense.findById(expense.id)
      .populate('paidBy', 'name email avatarColor')
      .populate('createdBy', 'name');

    res.json({ expense: populated });
  } catch (err) {
    console.error('Update group expense error:', err);
    res.status(500).json({ error: 'Could not update expense' });
  }
});

/** Delete shared expense (any member) */
router.delete('/:expenseId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = req.params.groupId as string;
    const userId = req.user!.userId;
    const check = await assertMember(groupId, userId);
    if ('error' in check && check.error) {
      res.status(check.status!).json({ error: check.error });
      return;
    }

    const expense = await GroupExpense.findOne({ _id: req.params.expenseId, group: groupId });
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    await expense.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete group expense error:', err);
    res.status(500).json({ error: 'Could not delete expense' });
  }
});

export default router;
