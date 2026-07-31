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

/** List groups I'm in */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const groups = await Group.find({ 'members.user': userId })
      .populate('members.user', 'name email avatarColor')
      .sort({ updatedAt: -1 });

    res.json({
      groups: groups.map(g => ({
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        inviteCode: g.inviteCode,
        memberCount: g.members.length,
        members: g.members,
        createdBy: g.createdBy,
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
    const { name, emoji } = req.body as { name?: string; emoji?: string };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }

    const inviteCode = makeInviteCode();
    const group = await Group.create({
      name: name.trim(),
      emoji: emoji?.trim() || '👥',
      createdBy: userId,
      inviteCode,
      members: [{ user: userId, role: 'owner', joinedAt: new Date() }],
    });

    res.status(201).json({
      group: {
        id: group.id,
        name: group.name,
        emoji: group.emoji,
        inviteCode: group.inviteCode,
        memberCount: 1,
      },
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
    const { inviteCode } = req.body as { inviteCode?: string };

    if (!inviteCode?.trim()) {
      res.status(400).json({ error: 'Invite code is required' });
      return;
    }

    const group = await Group.findOne({ inviteCode: inviteCode.trim().toUpperCase() });
    if (!group) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    if (isMember(group, userId)) {
      res.status(200).json({
        message: 'Already a member',
        group: { id: group.id, name: group.name, emoji: group.emoji },
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
      group: {
        id: group.id,
        name: group.name,
        emoji: group.emoji,
        inviteCode: group.inviteCode,
        memberCount: group.members.length,
      },
    });
  } catch (err) {
    console.error('Join group error:', err);
    res.status(500).json({ error: 'Could not join group' });
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

    res.json({ group });
  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Could not fetch group' });
  }
});

export default router;
