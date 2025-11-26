import type { Request, Response } from 'express';
import { aggregator } from '../services/sentiment/aggregator.js';

export const sentimentController = {
  getSentiment: async (req: Request, res: Response) => {
    const symbol = (req.query.symbol as string) || 'BTC';
    const data = await aggregator.score(symbol);
    return res.json(data);
  }
};

