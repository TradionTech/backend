/**
 * Auth Controller
 *
 * Helper endpoints for authentication, primarily for testing purposes.
 */

import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { logger } from '../config/logger';

export const authController = {
  /**
   * Get current auth info (for testing/debugging).
   *
   * This endpoint returns information about the current authenticated user.
   * Useful for verifying that authentication is working correctly.
   *
   * GET /api/auth/info
   */
  getAuthInfo: async (req: Request, res: Response) => {
    try {
      // Handle Clerk API changes - getAuth might throw if token is invalid
      let userId: string | null = null;
      let sessionId: string | null = null;

      try {
        const auth = getAuth(req);
        userId = auth.userId;
        sessionId = auth.sessionId;
      } catch (authError: any) {
        // If getAuth throws, it means the token is invalid/expired
        logger.warn('getAuth failed', { error: authError.message });
        return res.status(401).json({
          error: 'Authentication failed',
          message: authError.message || 'Invalid or expired token. Please get a new token.',
        });
      }

      if (!userId) {
        return res.status(401).json({
          error: 'Not authenticated',
          message:
            'No valid authentication token provided. Make sure you include: Authorization: Bearer <token>',
        });
      }

      return res.json({
        userId,
        sessionId,
        message: 'Authentication successful',
        note: 'Use the Authorization header with this token for other requests',
      });
    } catch (error: any) {
      logger.error('Failed to get auth info', {
        error: error.message,
        stack: error.stack,
      });

      return res.status(401).json({
        error: 'Authentication failed',
        message: error.message || 'Invalid or expired token',
      });
    }
  },
};
