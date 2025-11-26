import type { Response } from 'express';
import { User } from '../db/models/User';
import type { AuthRequest } from '../types/express';

export async function ensureUser(req: AuthRequest, res: Response) {
  const { id, email } = (req.body ?? {}) as { id?: string; email?: string | null };
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!req.auth?.userId || req.auth.userId !== id)
    return res.status(401).json({ error: 'unauthorized' });
  await User.upsert({ id, email: email ?? null, plan: 'free', proExpiry: null });
  return res.status(204).end();
}
