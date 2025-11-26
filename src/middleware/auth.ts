import { getAuth, requireAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { User } from '../db/models/User.js';
import { logger } from '../config/logger.js';
import type { AuthRequest } from '../types/express.js';

/** Require Clerk auth and ensure a User row exists for this Clerk userId. */
export function authGuard() {
  const mw = requireAuth();
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Clerk will throw if not authenticated
      await (mw as any)(req, res, async () => {
        const { userId, sessionId } = getAuth(req);
        if (!userId) {
          logger.warn('Auth failed: missing userId', { ip: req.ip, path: req.path });
          return res.status(401).json({ error: 'Unauthorized', message: 'Invalid authentication' });
        }
        // Upsert local user with email from Clerk claims if available
        const claims = (req as any).auth?.claims;
        const email = claims?.email || null;
        const [user] = await User.findOrCreate({
          where: { id: userId },
          defaults: { plan: 'free', email },
        });
        // Update email if it changed in Clerk
        if (email && user.email !== email) {
          await user.update({ email });
        }
        (req as any).auth = { userId, sessionId };
        next();
      });
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
      const { userId, sessionId } = getAuth(req);
      if (userId) {
        const user = await User.findByPk(userId);
        if (user) {
          (req as any).auth = { userId, sessionId };
        }
      }
    } catch (e) {
      // Silently ignore auth errors for optional auth
      logger.debug('Optional auth failed', { path: req.path });
    }
    next();
  };
}
