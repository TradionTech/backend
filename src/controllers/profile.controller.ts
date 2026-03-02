import type { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { recomputeUserProfileMetrics, getUserProfileMetrics } from '../services/profile/profileService.js';

export const profileController = {
  recomputeProfileHandler: async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.params.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      // Optional: restrict to same user or admin
      const { userId: authUserId } = getAuth(req);
      if (authUserId && authUserId !== userId) {
        return res.status(403).json({ error: 'Forbidden: can only recompute own profile' });
      }

      // Get optional maxTrades from query or body
      const maxTrades = req.query.maxTrades 
        ? parseInt(String(req.query.maxTrades), 10)
        : req.body.maxTrades;

      const metrics = await recomputeUserProfileMetrics({
        userId,
        maxTrades: maxTrades && !isNaN(maxTrades) ? maxTrades : undefined,
      });

      return res.json(metrics);
    } catch (err) {
      next(err);
    }
  },

  getProfileHandler: async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.params.userId;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      // Optional: restrict to same user or admin
      const { userId: authUserId } = getAuth(req);
      if (authUserId && authUserId !== userId) {
        return res.status(403).json({ error: 'Forbidden: can only view own profile' });
      }

      const metrics = await getUserProfileMetrics(userId);
      if (!metrics) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      return res.json(metrics);
    } catch (err) {
      next(err);
    }
  },
};
