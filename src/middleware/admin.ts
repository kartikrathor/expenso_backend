import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload, AuthRequest } from './auth';
import { User } from '../models/User';

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const run = async () => {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = await User.findById(req.user.userId).select('role email');
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access only' });
      return;
    }
    // Refresh JWT payload role if present
    (req.user as AuthPayload & { role?: string }).role = 'admin';
    next();
  };
  run().catch(() => {
    res.status(500).json({ error: 'Could not verify admin' });
  });
}

/** Touch lastActiveAt (fire-and-forget). */
export function touchUserActive(userId: string): void {
  void User.findByIdAndUpdate(userId, { lastActiveAt: new Date() }).exec();
}
