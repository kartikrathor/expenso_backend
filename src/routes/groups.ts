import { Router, Response } from 'express';
import { customAlphabet } from 'nanoid';
import { Types } from 'mongoose';
import { Group } from '../models/Group';
import { AuthRequest, requireAuth } from '../middleware/auth';

const router = Router();
const makeInviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

function isMember(group: { members: { user: { toString(): string } }[] }, userId: string): boolean {
  return group.members.some(m => m.user.toString() === userId);
}

function groupPayload(g: InstanceType<typeof Group>) {
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    inviteCode: g.inviteCode,
    memberCount: g.members.length,
    monthlyBudget: g.monthlyBudget ?? 0,
    createdBy: g.createdBy,
  };
}

/** List groups I'm in */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const groups = await Group.find({ 'members.user': userId })
      .populate('members.user', 'name email avatarColor')
      .sort({ updatedAt: -1 });

    res.json({
      groups: groups.map(g => ({
        ...groupPayload(g),
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
    const { name, emoji, monthlyBudget } = req.body as {
      name?: string;
      emoji?: string;
      monthlyBudget?: number;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }

    const budget =
      typeof monthlyBudget === 'number' && monthlyBudget > 0 ? monthlyBudget : 0;

    const inviteCode = makeInviteCode();
    const group = await Group.create({
      name: name.trim(),
      emoji: emoji?.trim() || '👥',
      createdBy: userId,
      inviteCode,
      monthlyBudget: budget,
      members: [{ user: userId, role: 'owner', joinedAt: new Date() }],
    });

    res.status(201).json({
      group: groupPayload(group),
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
    const { inviteCode, monthlyBudget } = req.body as {
      inviteCode?: string;
      monthlyBudget?: number;
    };

    if (!inviteCode?.trim()) {
      res.status(400).json({ error: 'Invite code is required' });
      return;
    }

    const group = await Group.findOne({ inviteCode: inviteCode.trim().toUpperCase() });
    if (!group) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    const joinerBudget =
      typeof monthlyBudget === 'number' && monthlyBudget > 0 ? monthlyBudget : 0;
    const mergedBudget = Math.max(group.monthlyBudget ?? 0, joinerBudget);
    if (mergedBudget !== (group.monthlyBudget ?? 0)) {
      group.monthlyBudget = mergedBudget;
    }

    if (isMember(group, userId)) {
      await group.save();
      res.status(200).json({
        message: 'Already a member',
        group: groupPayload(group),
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
      group: groupPayload(group),
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

    const { monthlyBudget, mergeMax } = req.body as {
      monthlyBudget?: number;
      mergeMax?: boolean;
    };

    if (typeof monthlyBudget !== 'number' || monthlyBudget < 0) {
      res.status(400).json({ error: 'monthlyBudget must be a non-negative number' });
      return;
    }

    if (mergeMax) {
      group.monthlyBudget = Math.max(group.monthlyBudget ?? 0, monthlyBudget);
    } else {
      group.monthlyBudget = monthlyBudget;
    }
    await group.save();

    res.json({ group: groupPayload(group) });
  } catch (err) {
    console.error('Update budget error:', err);
    res.status(500).json({ error: 'Could not update budget' });
  }
});

/** Group detail */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
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
        monthlyBudget: group.monthlyBudget ?? 0,
      },
    });
  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Could not fetch group' });
  }
});

export default router;
