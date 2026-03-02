import type { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { User } from '../db/models/User';

export function requirePlan(plan: 'pro') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Expiry check for one-time
    if (user.plan === 'pro' && user.proExpiry && new Date(user.proExpiry) < new Date()) {
      user.plan = 'free';
      await user.save();
    }

    if (user.plan !== plan) {
      return res.status(403).json({ error: 'Upgrade to Pro to access this feature.' });
    }
    return next();
  };
}
