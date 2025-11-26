import type { Request, Response } from 'express';
import { JournalEntry } from '../db/models/JournalEntry.js';
import { journalCoach } from '../services/ai/journalCoach.js';
import { Usage } from '../services/usage/usage.js';
import { Limits } from '../services/plans/limits.js';

export const journalController = {
  createEntry: async (req: Request, res: Response) => {
    const userId = (req as any).auth.userId as string;
    const { symbol, direction, entry_price, exit_price, notes } = req.body;

    const entry = await JournalEntry.create({
      userId,
      symbol,
      direction,
      entryPrice: entry_price,
      exitPrice: exit_price ?? null,
      notes: notes ?? null
    });

    return res.status(201).json(entry);
  },

  analyze: async (req: Request, res: Response) => {
    const userId = (req as any).auth.userId as string;

    await Usage.ensureDailyRow(userId);
    const plan = await Usage.getPlan(userId);
    const { analysesToday } = await Usage.getCounters(userId);
    if (plan === 'free' && analysesToday >= Limits.free.maxAnalysesPerDay) {
      return res.status(402).json({ error: 'Free plan daily analysis limit reached. Upgrade to Pro.' });
    }

    const { symbol, direction, entry_price, exit_price, notes } = req.body;
    const analysis = await journalCoach.analyze({
      symbol,
      direction,
      entry: entry_price,
      exit: exit_price,
      notes
    });

    const entry = await JournalEntry.create({
      userId,
      symbol,
      direction,
      entryPrice: entry_price,
      exitPrice: exit_price ?? null,
      notes: notes ?? null,
      aiFeedback: analysis
    });

    await Usage.inc(userId, 'analysesToday');
    return res.json(analysis);
  }
};

