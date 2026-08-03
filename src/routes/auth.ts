import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { Group } from '../models/Group';
import { GroupExpense } from '../models/GroupExpense';
import { PersonalExpense } from '../models/PersonalExpense';
import { AssistantUsage } from '../models/AssistantUsage';
import { AssistantMiss } from '../models/AssistantIntent';
import { UserCategory } from '../models/Category';
import { AuthRequest, requireAuth, signToken } from '../middleware/auth';

const router = Router();

const AVATAR_COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F472B6', '#FBBF24', '#F87171', '#A855F7'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const NAME_RE = /^[\p{L}\p{M}\s.'-]{2,50}$/u;

function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Email is required';
  if (email.length > 100) return 'Email is too long';
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address';
  return null;
}

function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  if (password.length > 72) return 'Password is too long';
  return null;
}

router.post('/register', async (req, res: Response) => {
  try {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };

    const trimmedName = (name ?? '').trim().replace(/\s+/g, ' ');
    const trimmedEmail = (email ?? '').trim().toLowerCase();

    if (!trimmedName) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (trimmedName.length < 2) {
      res.status(400).json({ error: 'Name must be at least 2 characters' });
      return;
    }
    if (trimmedName.length > 50) {
      res.status(400).json({ error: 'Name must be under 50 characters' });
      return;
    }
    if (!NAME_RE.test(trimmedName)) {
      res.status(400).json({ error: "Name can only contain letters, spaces, and . ' -" });
      return;
    }

    const emailError = validateEmail(trimmedEmail);
    if (emailError) {
      res.status(400).json({ error: emailError });
      return;
    }

    const passwordError = validatePassword(password ?? '');
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    const existing = await User.findOne({ email: trimmedEmail });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password!, 10);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const user = await User.create({
      name: trimmedName,
      email: trimmedEmail,
      passwordHash,
      avatarColor,
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role || 'user' });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarColor: user.avatarColor,
        role: user.role || 'user',
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not register' });
  }
});

router.post('/login', async (req, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    const trimmedEmail = (email ?? '').trim().toLowerCase();

    const emailError = validateEmail(trimmedEmail);
    if (emailError) {
      res.status(400).json({ error: emailError });
      return;
    }

    const passwordError = validatePassword(password ?? '');
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    const user = await User.findOne({ email: trimmedEmail });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const ok = await bcrypt.compare(password!, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    user.lastActiveAt = new Date();
    await user.save();

    const token = signToken({ userId: user.id, email: user.email, role: user.role || 'user' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarColor: user.avatarColor,
        role: user.role || 'user',
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not login' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.userId).select('-passwordHash');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarColor: user.avatarColor,
        role: user.role || 'user',
      },
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

router.delete('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const uid = new Types.ObjectId(userId);

    const groups = await Group.find({ 'members.user': uid });
    for (const group of groups) {
      group.members = group.members.filter(m => m.user.toString() !== userId);
      if (group.members.length === 0) {
        await GroupExpense.deleteMany({ group: group._id });
        await group.deleteOne();
      } else {
        if (group.createdBy.toString() === userId) {
          group.createdBy = group.members[0].user;
          group.members[0].role = 'owner';
        }
        await group.save();
      }
    }

    await GroupExpense.deleteMany({ createdBy: uid });
    await PersonalExpense.deleteMany({ user: uid });
    await AssistantUsage.deleteMany({ userId: String(userId) });
    await AssistantMiss.deleteMany({ userId: uid });
    await UserCategory.deleteMany({ user: uid });
    await User.deleteOne({ _id: uid });

    res.json({ message: 'Account and data deleted' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Could not delete account' });
  }
});

/**
 * Wipe this user's app data but keep the login account.
 * Personal expenses, budget, Ask usage, custom categories — account stays.
 */
router.delete('/me/data', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const uid = new Types.ObjectId(userId);

    const [expenses, usage, misses, categories] = await Promise.all([
      PersonalExpense.deleteMany({ user: uid }),
      AssistantUsage.deleteMany({ userId: String(userId) }),
      AssistantMiss.deleteMany({ userId: uid }),
      UserCategory.deleteMany({ user: uid }),
    ]);

    await User.updateOne(
      { _id: uid },
      { $set: { monthlyBudget: 0 } },
    );

    res.json({
      message: 'All personal data cleared; account kept',
      deleted: {
        expenses: expenses.deletedCount || 0,
        assistantUsage: usage.deletedCount || 0,
        assistantMisses: misses.deletedCount || 0,
        customCategories: categories.deletedCount || 0,
      },
    });
  } catch (err) {
    console.error('Clear user data error:', err);
    res.status(500).json({ error: 'Could not clear data' });
  }
});

export default router;
