import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err.status || 500;
  const body = { error: err.message || 'Internal Server Error' };
  if (status >= 500) {
    // Optionally log stack
    console.error(err);
  }
  res.status(status).json(body);
}

