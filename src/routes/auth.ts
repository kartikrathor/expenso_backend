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
import { PasswordResetRequest } from '../models/PasswordResetRequest';
import { AuthRequest, requireAuth, signToken } from '../middleware/auth';
import { entitlementPayload } from '../services/proEntitlements';
import {
  compareSecret,
  isKnownDevice,
  issueTempPasswordForRequest,
  normalizeDeviceId,
  normalizePlatform,
  serializeResetForClient,
  touchUserDevice,
} from '../services/passwordReset';

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
  if (password.length < 6) return 'Password must be at least 6 characters';
  if (password.length > 72) return 'Password is too long';
  return null;
}

function publicUser(user: {
  id?: string;
  _id?: { toString(): string };
  name: string;
  email: string;
  avatarColor: string;
  role?: string;
  notifyPartnerOnMyJointAdd?: boolean;
  notifyMeOnPartnerJointAdd?: boolean;
  mustChangePassword?: boolean;
  proPlan?: string | null;
  proStatus?: string | null;
  proExpiresAt?: Date | null;
  themePurchases?: Array<{
    packId: string;
    kind: string;
    purchasedAt?: Date;
    expiresAt?: Date | null;
  }>;
}) {
  return {
    id: user.id || String(user._id),
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    role: user.role || 'user',
    notifyPartnerOnMyJointAdd: user.notifyPartnerOnMyJointAdd !== false,
    notifyMeOnPartnerJointAdd: user.notifyMeOnPartnerJointAdd !== false,
    mustChangePassword: !!user.mustChangePassword,
    pro: entitlementPayload(user),
  };
}

router.post('/register', async (req, res: Response) => {
  try {
    const { name, email, password, deviceId: rawDeviceId, platform: rawPlatform } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      deviceId?: string;
      platform?: string;
    };

    const trimmedName = (name ?? '').trim().replace(/\s+/g, ' ');
    const trimmedEmail = (email ?? '').trim().toLowerCase();
    const deviceId = normalizeDeviceId(rawDeviceId);
    const platform = normalizePlatform(rawPlatform);

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

    if (!deviceId) {
      res.status(400).json({ error: 'Device id is required' });
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

    touchUserDevice(user, deviceId, platform, true);
    await user.save();

    const token = signToken({ userId: user.id, email: user.email, role: user.role || 'user' });

    res.status(201).json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not register' });
  }
});

router.post('/login', async (req, res: Response) => {
  try {
    const { email, password, deviceId: rawDeviceId, platform: rawPlatform } = req.body as {
      email?: string;
      password?: string;
      deviceId?: string;
      platform?: string;
    };
    const trimmedEmail = (email ?? '').trim().toLowerCase();
    const deviceId = normalizeDeviceId(rawDeviceId);
    const platform = normalizePlatform(rawPlatform);

    const emailError = validateEmail(trimmedEmail);
    if (emailError) {
      res.status(400).json({ error: emailError });
      return;
    }

    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }
    if (password.length > 72) {
      res.status(400).json({ error: 'Password is too long' });
      return;
    }

    const user = await User.findOne({ email: trimmedEmail });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (deviceId) {
      touchUserDevice(user, deviceId, platform, true);
    } else {
      user.lastActiveAt = new Date();
    }
    await user.save();

    const token = signToken({ userId: user.id, email: user.email, role: user.role || 'user' });

    res.json({
      token,
      user: publicUser(user),
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
      user: publicUser(user),
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

router.patch('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const body = req.body as {
      notifyPartnerOnMyJointAdd?: boolean;
      notifyMeOnPartnerJointAdd?: boolean;
    };

    if (typeof body.notifyPartnerOnMyJointAdd === 'boolean') {
      user.notifyPartnerOnMyJointAdd = body.notifyPartnerOnMyJointAdd;
    }
    if (typeof body.notifyMeOnPartnerJointAdd === 'boolean') {
      user.notifyMeOnPartnerJointAdd = body.notifyMeOnPartnerJointAdd;
    }

    await user.save();
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Patch me error:', err);
    res.status(500).json({ error: 'Could not update preferences' });
  }
});

/** Change password (required after temp password from support). */
router.post('/change-password', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!currentPassword) {
      res.status(400).json({ error: 'Current password is required' });
      return;
    }
    const newErr = validatePassword(newPassword ?? '');
    if (newErr) {
      res.status(400).json({ error: newErr });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password must be different' });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    user.passwordHash = await bcrypt.hash(newPassword!, 10);
    user.mustChangePassword = false;
    await user.save();

    // Mark open reset requests completed for this user
    await PasswordResetRequest.updateMany(
      {
        user: user._id,
        status: { $in: ['temp_password_sent', 'verified', 'pending', 'awaiting_verification'] },
      },
      { $set: { status: 'completed', completedAt: new Date() } },
    );

    res.json({ user: publicUser(user), message: 'Password updated' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Could not change password' });
  }
});

/**
 * Start password reset via support.
 * Same device → pending (admin can send temp password).
 * New device → pending + must request verification (admin sends OTP/link).
 */
router.post('/password-reset/request', async (req, res: Response) => {
  try {
    const { email, deviceId: rawDeviceId, platform: rawPlatform, note } = req.body as {
      email?: string;
      deviceId?: string;
      platform?: string;
      note?: string;
    };

    const trimmedEmail = (email ?? '').trim().toLowerCase();
    const deviceId = normalizeDeviceId(rawDeviceId);
    const platform = normalizePlatform(rawPlatform);
    const userNote = String(note || '').trim().slice(0, 500);

    const emailError = validateEmail(trimmedEmail);
    if (emailError) {
      res.status(400).json({ error: emailError });
      return;
    }
    if (!deviceId) {
      res.status(400).json({ error: 'Device id is required' });
      return;
    }

    const user = await User.findOne({ email: trimmedEmail });
    // Avoid account enumeration — same shape either way
    if (!user) {
      res.json({
        ok: true,
        created: false,
        message:
          'If an account exists for this email, support will review your reset request. Use the same device you usually log in from when possible.',
      });
      return;
    }

    const sameDevice = isKnownDevice(user, deviceId);

    // Reuse open request from same device
    let existing = await PasswordResetRequest.findOne({
      user: user._id,
      deviceId,
      status: {
        $in: ['pending', 'awaiting_verification', 'verified', 'temp_password_sent'],
      },
    }).sort({ createdAt: -1 });

    if (!existing) {
      const bodyMsg = sameDevice
        ? `Password reset requested from a known device (${platform}).${userNote ? `\n\nUser note: ${userNote}` : ''}`
        : `Password reset requested from a NEW device (${platform}). Verification required.${userNote ? `\n\nUser note: ${userNote}` : ''}`;

      existing = await PasswordResetRequest.create({
        email: trimmedEmail,
        user: user._id,
        deviceId,
        platform,
        sameDevice,
        status: sameDevice ? 'pending' : 'pending',
        lastLoginAtAtRequest: user.lastLoginAt || user.lastActiveAt || null,
        lastLoginDeviceIdAtRequest: user.lastLoginDeviceId || '',
        messages: [
          {
            role: 'user',
            message: bodyMsg,
            createdAt: new Date(),
          },
          {
            role: 'system',
            message: sameDevice
              ? 'Same device as a previous login. Support can send a temporary password.'
              : 'Different device. Ask support to send a verification OTP/link first.',
            createdAt: new Date(),
          },
        ],
      });
    }

    res.status(201).json({
      ok: true,
      created: true,
      request: serializeResetForClient(existing),
      message: sameDevice
        ? 'Request sent to support. On a known device, support can send you a temporary password here.'
        : 'New device detected. Request sent to support — they must verify you (OTP/link) before a temporary password is issued.',
    });
  } catch (err) {
    console.error('Password reset request error:', err);
    res.status(500).json({ error: 'Could not create reset request' });
  }
});

/** Poll reset request + support messages (device must match). */
router.get('/password-reset/:id', async (req, res: Response) => {
  try {
    const deviceId = normalizeDeviceId(String(req.query.deviceId || ''));
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const doc = await PasswordResetRequest.findById(req.params.id);
    if (!doc || doc.deviceId !== deviceId) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    res.json({ request: serializeResetForClient(doc) });
  } catch (err) {
    console.error('Password reset get error:', err);
    res.status(500).json({ error: 'Could not load reset request' });
  }
});

/** Verify OTP or link token from support (new-device flow). Auto-issues temp password. */
router.post('/password-reset/:id/verify', async (req, res: Response) => {
  try {
    const { deviceId: rawDeviceId, otp, token } = req.body as {
      deviceId?: string;
      otp?: string;
      token?: string;
    };
    const deviceId = normalizeDeviceId(rawDeviceId);
    if (!deviceId) {
      res.status(400).json({ error: 'Device id is required' });
      return;
    }
    if (!Types.ObjectId.isValid(req.params.id)) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const doc = await PasswordResetRequest.findById(req.params.id);
    if (!doc || doc.deviceId !== deviceId) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (['rejected', 'completed'].includes(doc.status)) {
      res.status(400).json({ error: 'This reset request is closed' });
      return;
    }

    if (doc.status === 'temp_password_sent') {
      res.json({
        request: serializeResetForClient(doc),
        message: 'Already verified — check messages for your temporary password.',
      });
      return;
    }

    const otpVal = String(otp || '').trim();
    const tokenVal = String(token || '').trim();
    if (!otpVal && !tokenVal) {
      res.status(400).json({ error: 'Enter the OTP or verification token from support' });
      return;
    }

    let matched = false;
    const now = Date.now();

    if (otpVal && doc.otpHash) {
      if (doc.otpExpiresAt && +doc.otpExpiresAt < now) {
        res.status(400).json({ error: 'OTP expired. Ask support to send a new one.' });
        return;
      }
      matched = await compareSecret(otpVal, doc.otpHash);
    }

    if (!matched && tokenVal && doc.verificationTokenHash) {
      if (doc.verificationExpiresAt && +doc.verificationExpiresAt < now) {
        res.status(400).json({ error: 'Link expired. Ask support to send a new one.' });
        return;
      }
      matched = await compareSecret(tokenVal, doc.verificationTokenHash);
    }

    if (!matched) {
      res.status(401).json({ error: 'Invalid OTP or verification link' });
      return;
    }

    doc.status = 'verified';
    doc.verifiedAt = new Date();
    doc.otpHash = '';
    doc.verificationTokenHash = '';
    doc.messages.push({
      role: 'system',
      message: 'Device verified successfully. Issuing temporary password…',
      createdAt: new Date(),
    });
    await doc.save();

    await issueTempPasswordForRequest(doc);

    res.json({
      request: serializeResetForClient(doc),
      message: 'Verified. Your temporary password is in the messages below — log in, then change it.',
    });
  } catch (err) {
    console.error('Password reset verify error:', err);
    res.status(500).json({ error: 'Could not verify' });
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
    await PasswordResetRequest.deleteMany({ user: uid });
    await User.deleteOne({ _id: uid });

    res.json({ message: 'Account and data deleted' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Could not delete account' });
  }
});

/**
 * Wipe this user's app data but keep the login account.
 * Personal expenses, budget, Ask misses, custom categories — account stays.
 * Daily AI token usage is NOT reset (abuse prevention).
 */
router.delete('/me/data', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const uid = new Types.ObjectId(userId);

    const [expenses, misses, categories] = await Promise.all([
      PersonalExpense.deleteMany({ user: uid }),
      AssistantMiss.deleteMany({ userId: uid }),
      UserCategory.deleteMany({ user: uid }),
    ]);

    await User.updateOne({ _id: uid }, { $set: { monthlyBudget: 0 } });

    res.json({
      message: 'All personal data cleared; account kept',
      deleted: {
        expenses: expenses.deletedCount || 0,
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
