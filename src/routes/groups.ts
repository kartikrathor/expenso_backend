import { Router, Response } from 'express';
import { customAlphabet } from 'nanoid';
import { Types } from 'mongoose';
import { Group } from '../models/Group';
import { AuthRequest, requireAuth } from '../middleware/auth';
import {
  budgetPayload,
  currentUtcMonth,
  isValidBudgetAmount,
  isValidMonthKey,
  resolveMonthlyBudget,
  upsertMonthlyBudget,
} from '../services/monthlyBudgets';

const router = Router();
const makeInviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

function isMember(group: { members: { user: { toString(): string } }[] }, userId: string): boolean {
  return group.members.some(m => m.user.toString() === userId);
}

function groupPayload(g: InstanceType<typeof Group>, month = currentUtcMonth()) {
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    inviteCode: g.inviteCode,
    memberCount: g.members.length,
    ...budgetPayload(g, month),
    createdBy: g.createdBy,
  };
}

/** List groups I'm in */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const rawMonth = req.query.month;
    const month = rawMonth === undefined ? currentUtcMonth() : rawMonth;
    if (!isValidMonthKey(month)) {
      res.status(400).json({ error: 'month must use YYYY-MM format' });
      return;
    }
    const groups = await Group.find({ 'members.user': userId })
      .populate('members.user', 'name email avatarColor')
      .sort({ updatedAt: -1 });

    res.json({
      groups: groups.map(g => ({
        ...groupPayload(g, month),
        members: g.members,
      })),
    });
  } catch (err) {
    console.error('List groups error:', err);
    res.status(500).json({ error: 'Could not list groups' });
  }
});

/** Create a group */
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { name, emoji, monthlyBudget, month: rawMonth, repeatMonthlyBudget } = req.body as {
      name?: string;
      emoji?: string;
      monthlyBudget?: unknown;
      month?: unknown;
      repeatMonthlyBudget?: unknown;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }

    const month = rawMonth === undefined ? currentUtcMonth() : rawMonth;
    if (!isValidMonthKey(month)) {
      res.status(400).json({ error: 'month must use YYYY-MM format' });
      return;
    }
    if (monthlyBudget !== undefined && !isValidBudgetAmount(monthlyBudget)) {
      res.status(400).json({ error: 'monthlyBudget must be a non-negative number' });
      return;
    }
    if (repeatMonthlyBudget !== undefined && typeof repeatMonthlyBudget !== 'boolean') {
      res.status(400).json({ error: 'repeatMonthlyBudget must be a boolean' });
      return;
    }

    const inviteCode = makeInviteCode();
    const budget = isValidBudgetAmount(monthlyBudget) ? monthlyBudget : 0;
    const group = await Group.create({
      name: name.trim(),
      emoji: emoji?.trim() || '👥',
      createdBy: userId,
      inviteCode,
      monthlyBudget: month === currentUtcMonth() ? budget : 0,
      monthlyBudgets:
        monthlyBudget === undefined ? [] : [{ month, amount: budget }],
      repeatMonthlyBudget: repeatMonthlyBudget ?? false,
      members: [{ user: userId, role: 'owner', joinedAt: new Date() }],
    });

    res.status(201).json({
      group: groupPayload(group, month),
    });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Could not create group' });
  }
});

/** Join via invite code */
router.post('/join', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { inviteCode, monthlyBudget, month: rawMonth, repeatMonthlyBudget } = req.body as {
      inviteCode?: string;
      monthlyBudget?: unknown;
      month?: unknown;
      repeatMonthlyBudget?: unknown;
    };

    if (!inviteCode?.trim()) {
      res.status(400).json({ error: 'Invite code is required' });
      return;
    }
    const month = rawMonth === undefined ? currentUtcMonth() : rawMonth;
    if (!isValidMonthKey(month)) {
      res.status(400).json({ error: 'month must use YYYY-MM format' });
      return;
    }
    if (monthlyBudget !== undefined && !isValidBudgetAmount(monthlyBudget)) {
      res.status(400).json({ error: 'monthlyBudget must be a non-negative number' });
      return;
    }
    if (repeatMonthlyBudget !== undefined && typeof repeatMonthlyBudget !== 'boolean') {
      res.status(400).json({ error: 'repeatMonthlyBudget must be a boolean' });
      return;
    }

    const group = await Group.findOne({ inviteCode: inviteCode.trim().toUpperCase() });
    if (!group) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    if (isValidBudgetAmount(monthlyBudget)) {
      const existingBudget = resolveMonthlyBudget({
        month,
        monthlyBudgets: group.monthlyBudgets,
        repeatMonthlyBudget: group.repeatMonthlyBudget,
        legacyMonthlyBudget: group.monthlyBudget,
      });
      const mergedBudget = Math.max(existingBudget, monthlyBudget);
      group.monthlyBudgets = upsertMonthlyBudget(
        group.monthlyBudgets,
        month,
        mergedBudget,
      );
      if (month === currentUtcMonth()) group.monthlyBudget = mergedBudget;
    }
    if (typeof repeatMonthlyBudget === 'boolean') {
      group.repeatMonthlyBudget = repeatMonthlyBudget;
    }

    if (isMember(group, userId)) {
      await group.save();
      res.status(200).json({
        message: 'Already a member',
        group: groupPayload(group, month),
      });
      return;
    }

    group.members.push({
      user: new Types.ObjectId(userId),
      role: 'member',
      joinedAt: new Date(),
    });
    await group.save();

    res.json({
      message: 'Joined group',
      group: groupPayload(group, month),
    });
  } catch (err) {
    console.error('Join group error:', err);
    res.status(500).json({ error: 'Could not join group' });
  }
});

/** Leave joint account (separate from partner) */
router.post('/:id/leave', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const group = await Group.findById(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!isMember(group, userId)) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    group.members = group.members.filter(m => m.user.toString() !== userId);

    if (group.members.length === 0) {
      const { GroupExpense } = await import('../models/GroupExpense');
      await GroupExpense.deleteMany({ group: group._id });
      await group.deleteOne();
      res.json({ message: 'Left joint account', deleted: true });
      return;
    }

    if (group.createdBy.toString() === userId) {
      group.createdBy = group.members[0].user;
      group.members[0].role = 'owner';
    }

    await group.save();
    res.json({ message: 'Left joint account', deleted: false, group: groupPayload(group) });
  } catch (err) {
    console.error('Leave group error:', err);
    res.status(500).json({ error: 'Could not leave joint account' });
  }
});

/** Update shared monthly budget (any member). Uses max if client sends proposeMax. */
router.patch('/:id/budget', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const group = await Group.findById(req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!isMember(group, userId)) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const { monthlyBudget, mergeMax, month: rawMonth, repeatMonthlyBudget } = req.body as {
      monthlyBudget?: unknown;
      mergeMax?: boolean;
      month?: unknown;
      repeatMonthlyBudget?: unknown;
    };

    const month = rawMonth === undefined ? currentUtcMonth() : rawMonth;
    if (!isValidMonthKey(month)) {
      res.status(400).json({ error: 'month must use YYYY-MM format' });
      return;
    }
    if (!isValidBudgetAmount(monthlyBudget)) {
      res.status(400).json({ error: 'monthlyBudget must be a non-negative number' });
      return;
    }
    if (repeatMonthlyBudget !== undefined && typeof repeatMonthlyBudget !== 'boolean') {
      res.status(400).json({ error: 'repeatMonthlyBudget must be a boolean' });
      return;
    }

    const amount = mergeMax
      ? Math.max(
          resolveMonthlyBudget({
            month,
            monthlyBudgets: group.monthlyBudgets,
            repeatMonthlyBudget: group.repeatMonthlyBudget,
            legacyMonthlyBudget: group.monthlyBudget,
          }),
          monthlyBudget,
        )
      : monthlyBudget;
    group.monthlyBudgets = upsertMonthlyBudget(group.monthlyBudgets, month, amount);
    if (month === currentUtcMonth()) group.monthlyBudget = amount;
    if (typeof repeatMonthlyBudget === 'boolean') {
      group.repeatMonthlyBudget = repeatMonthlyBudget;
    }
    await group.save();

    res.json({ group: groupPayload(group, month) });
  } catch (err) {
    console.error('Update budget error:', err);
    res.status(500).json({ error: 'Could not update budget' });
  }
});

/** Group detail */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const rawMonth = req.query.month;
    const month = rawMonth === undefined ? currentUtcMonth() : rawMonth;
    if (!isValidMonthKey(month)) {
      res.status(400).json({ error: 'month must use YYYY-MM format' });
      return;
    }
    const group = await Group.findById(req.params.id).populate(
      'members.user',
      'name email avatarColor',
    );

    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!isMember(group, userId)) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    res.json({
      group: {
        ...group.toObject(),
        id: group.id,
        ...budgetPayload(group, month),
      },
    });
  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Could not fetch group' });
  }
});

export default router;
