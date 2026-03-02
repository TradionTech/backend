import { getAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { User } from '../db/models/User';
import { logger } from '../config/logger';

/** Require Clerk auth and ensure a User row exists for this Clerk userId. */
export function authGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Manually check authentication to avoid Clerk's default redirect behavior
      const { userId, sessionId } = getAuth(req);

      if (!userId) {
        logger.warn('Auth failed: missing userId', { ip: req.ip, path: req.path });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required. Please provide a valid token.',
        });
      }

      // Upsert local user (email will be set via webhook if not present)
      const [user] = await User.findOrCreate({
        where: { id: userId },
        defaults: { plan: 'free', email: null },
      });

      next();
    } catch (e: any) {
      logger.error('Auth error', { error: e?.message, ip: req.ip, path: req.path });
      const isExpired = e?.status === 401 || e?.message?.toLowerCase().includes('expired');
      return res.status(401).json({
        error: 'Unauthorized',
        message: isExpired ? 'Token expired. Please login again.' : 'Authentication failed',
      });
    }
  };
}

/** Optional Clerk auth - attaches user context if token is valid, but doesn't require auth. */
export function optionalAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = getAuth(req);
      if (userId) {
        await User.findByPk(userId);
      }
    } catch (e) {
      // Silently ignore auth errors for optional auth
      logger.debug('Optional auth failed', { path: req.path });
    }
    next();
  };
}
