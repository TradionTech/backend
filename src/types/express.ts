import type { Request } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';

export interface AuthData {
  userId: string;
  sessionId: string;
}

export interface AuthRequest<
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = ParsedQs,
  Locals extends Record<string, unknown> = Record<string, unknown>,
> extends Request<P, ResBody, ReqBody, ReqQuery, Locals> {
  auth?: AuthData;
}
