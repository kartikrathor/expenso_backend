import { Router, Response } from 'express';
import { Group } from '../models/Group';
import { GroupExpense } from '../models/GroupExpense';
import { User } from '../models/User';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { recordCategoryCorrection } from '../services/categoryLearning';
import { sendPushToUsers } from '../services/push';

const router = Router({ mergeParams: true });

async function assertMember(groupId: string, userId: string) {
  const group = await Group.findById(groupId);
  if (!group) return { error: 'Group not found', status: 404 as const };
  const ok = group.members.some(m => m.user.toString() === userId);
  if (!ok) return { error: 'Not a member of this group', status: 403 as const };
  return { group };
}

function formatInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function normalizeClientId(clientId?: string): string | undefined {
  const value = clientId?.trim().slice(0, 120);
  return value || undefined;
}

function exactDuplicateKey(expense: {
  amount: number;
  merchantLabel: string;
  category: string;
  note: string;
  date: Date;
  paidBy: unknown;
  splitAmong: unknown[];
  createdBy: unknown;
}): string {
  return JSON.stringify([
    Number(expense.amount),
    expense.merchantLabel.trim().toLowerCase(),
    expense.category.trim().toLowerCase(),
    expense.note.trim(),
    expense.date.toISOString(),
    String(expense.paidBy),
    expense.splitAmong.map(String).sort(),
    String(expense.createdBy),
  ]);
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
      .limit(1000)
      .lean();

    res.json({ expenses });
  } catch (err) {
    console.error('List group expenses error:', err);
    res.status(500).json({ error: 'Could not list expenses' });
  }
});

/** Remove historical exact copies created by outbox request retries. */
router.post('/dedupe', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = req.params.groupId as string;
    const check = await assertMember(groupId, req.user!.userId);
    if ('error' in check && check.error) {
      res.status(check.status!).json({ error: check.error });
      return;
    }

    const expenses = await GroupExpense.find({ group: groupId }).sort({ createdAt: 1 });
    const seen = new Set<string>();
    const duplicateIds = [];
    for (const expense of expenses) {
      const key = exactDuplicateKey(expense);
      if (seen.has(key)) duplicateIds.push(expense._id);
      else seen.add(key);
    }

    if (duplicateIds.length > 0) {
      await GroupExpense.deleteMany({ group: groupId, _id: { $in: duplicateIds } });
    }
    res.json({ removed: duplicateIds.length });
  } catch (err) {
    console.error('Dedupe group expenses error:', err);
    res.status(500).json({ error: 'Could not clean duplicate expenses' });
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

    const { amount, merchantLabel, category, note, date, paidBy, splitAmong, clientId } = req.body as {
      amount?: number;
      merchantLabel?: string;
      category?: string;
      note?: string;
      date?: string;
      paidBy?: string;
      splitAmong?: string[];
      clientId?: string;
    };

    if (!amount || amount <= 0 || !merchantLabel?.trim()) {
      res.status(400).json({ error: 'amount and merchantLabel are required' });
      return;
    }

    const stableClientId = normalizeClientId(clientId);
    const createData = {
      ...(stableClientId ? { clientId: stableClientId } : {}),
      amount,
      merchantLabel: merchantLabel.trim(),
      category: category || 'other',
      note: note?.trim() || '',
      date: date ? new Date(date) : new Date(),
      paidBy: paidBy || userId,
      splitAmong: splitAmong || [],
      createdBy: userId,
    };
    const expense = stableClientId
      ? await GroupExpense.findOneAndUpdate(
          { group: groupId, clientId: stableClientId },
          { $setOnInsert: { group: groupId, ...createData } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
      : await GroupExpense.create({ group: groupId, ...createData });

    const populated = await GroupExpense.findById(expense.id)
      .populate('paidBy', 'name email avatarColor')
      .populate('createdBy', 'name');

    // Notify other joint members (respect send/receive preferences)
    const group = check.group!;
    const actor = await User.findById(userId).select(
      'name notifyPartnerOnMyJointAdd',
    );
    const actorWantsSend = actor?.notifyPartnerOnMyJointAdd !== false;
    const others = group.members
      .map(m => m.user.toString())
      .filter(id => id !== userId);

    if (actorWantsSend && others.length) {
      const recipients = await User.find({
        _id: { $in: others },
        notifyMeOnPartnerJointAdd: { $ne: false },
      }).select('_id');
      const recipientIds = recipients.map(u => u.id);
      if (recipientIds.length) {
        const who = actor?.name?.split(/\s+/)[0] || 'Partner';
        const label = merchantLabel.trim();
        const noteBit = note?.trim() ? ` · ${note.trim().slice(0, 40)}` : '';
        void sendPushToUsers(recipientIds, {
          title: `${who} added an expense`,
          body: `${formatInr(amount)} · ${label}${noteBit}`,
          data: {
            type: 'joint_expense',
            groupId: String(groupId),
            expenseId: expense.id,
            actorName: who,
            amount: String(amount),
            merchantLabel: label,
          },
        }).catch(err => console.warn('Joint expense push failed:', err));
      }
    }

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
    let categoryCorrection: { fromCategory: string; toCategory: string } | null = null;

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
        categoryCorrection = { fromCategory: prevCat, toCategory: nextCat };
      }
    }
    if (note !== undefined) expense.note = note.trim();
    if (date !== undefined) expense.date = new Date(date);

    await expense.save();
    if (categoryCorrection) {
      await recordCategoryCorrection({
        userId,
        ...categoryCorrection,
        merchantLabel: expense.merchantLabel,
        note: expense.note,
      }).catch(err => console.warn('Joint category learning failed:', err));
    }

    const populated = await GroupExpense.findById(expense.id)
      .populate('paidBy', 'name email avatarColor')
      .populate('createdBy', 'name');

    res.json({ expense: populated });
  } catch (err) {
    console.error('Update group expense error:', err);
    res.status(500).json({ error: 'Could not update expense' });
  }
});

/** Cancel an optimistic/outbox create even if its POST response was lost. */
router.delete('/by-client/:clientId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const groupId = req.params.groupId as string;
    const check = await assertMember(groupId, req.user!.userId);
    if ('error' in check && check.error) {
      res.status(check.status!).json({ error: check.error });
      return;
    }

    const result = await GroupExpense.deleteMany({
      group: groupId,
      clientId: req.params.clientId,
    });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Cancel group expense create error:', err);
    res.status(500).json({ error: 'Could not cancel expense' });
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

    const expense = await GroupExpense.findOneAndDelete({
      _id: req.params.expenseId,
      group: groupId,
    });
    // Idempotent for outbox retries after a successful delete response is lost.
    res.json({ ok: true, alreadyDeleted: !expense });
  } catch (err) {
    console.error('Delete group expense error:', err);
    res.status(500).json({ error: 'Could not delete expense' });
  }
});

export default router;
