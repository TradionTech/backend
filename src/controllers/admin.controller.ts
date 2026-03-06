import type { Request, Response } from 'express';

export const adminController = {
  health: async (req: Request, res: Response) => {
    if (req.method === 'HEAD') {
      return res.sendStatus(200);
    }
    res.json({ ok: true });
  },

  metrics: async (_req: Request, res: Response) => {
    // TODO: aggregate usage, payments, errors
    res.json({ users: 'TODO', metrics: {} });
  }
};

