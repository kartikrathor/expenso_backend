import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { User } from '../models/User';

const router = Router();

/** Register / refresh this device's FCM token */
router.post('/fcm-token', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (token.length < 20 || token.length > 4096) {
      res.status(400).json({ error: 'Invalid FCM token' });
      return;
    }

    await User.updateOne(
      { _id: req.user!.userId },
      { $addToSet: { fcmTokens: token } },
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Register FCM token error:', err);
    res.status(500).json({ error: 'Could not save device token' });
  }
});

/** Remove token on logout / permission revoke */
router.delete('/fcm-token', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const token = String(req.body?.token || req.query?.token || '').trim();
    if (!token) {
      res.status(400).json({ error: 'Token required' });
      return;
    }
    await User.updateOne({ _id: req.user!.userId }, { $pull: { fcmTokens: token } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove FCM token error:', err);
    res.status(500).json({ error: 'Could not remove device token' });
  }
});

export default router;
