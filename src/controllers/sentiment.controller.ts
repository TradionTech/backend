import type { Request, Response } from 'express';
import { aggregator } from '../services/sentiment/aggregator';
import { sentimentService } from '../services/sentiment/sentimentService';

export const sentimentController = {
  getSentiment: async (req: Request, res: Response) => {
    const symbol = (req.query.symbol as string) || 'BTC';
    const data = await aggregator.score(symbol);
    return res.json(data);
  },

  /**
   * Get sentiment snapshot for a symbol.
   * 
   * GET /sentiment/snapshot/:symbol?windowMinutes=240
   */
  getSentimentSnapshot: async (req: Request, res: Response) => {
    try {
      const symbol = req.params.symbol;
      if (!symbol) {
        return res.status(400).json({ error: 'Symbol parameter is required' });
      }

      const windowMinutes = req.query.windowMinutes
        ? parseInt(req.query.windowMinutes as string, 10)
        : undefined;

      if (windowMinutes !== undefined && (isNaN(windowMinutes) || windowMinutes <= 0)) {
        return res.status(400).json({ error: 'windowMinutes must be a positive number' });
      }

      const userId = (req as any).user?.id; // Extract from auth middleware if available

      const sentimentContext = await sentimentService.buildSentimentContext({
        symbol,
        windowMinutes,
        userId,
      });

      return res.json(sentimentContext);
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to build sentiment snapshot',
        message: (error as Error).message,
      });
    }
  },
};
