import type { Request } from 'express';

export interface AuthData {
  userId: string;
  sessionId: string;
}

export interface AuthRequest extends Request {
  auth?: AuthData;
}
