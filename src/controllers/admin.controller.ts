import type { Request, Response } from 'express';

export const adminController = {
  health: async (_req: Request, res: Response) => {
    res.json({ ok: true });
  },

  metrics: async (_req: Request, res: Response) => {
    // TODO: aggregate usage, payments, errors
    res.json({ users: 'TODO', metrics: {} });
  }
};

