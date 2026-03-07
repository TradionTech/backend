import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { JournalEntry } from '../db/models/JournalEntry';
import { journalCoach, journalCoachLegacy } from '../services/ai/journalCoach';
import { journalService } from '../services/journal/journalService';
import { journalDashboardService } from '../services/journal/journalDashboardService';
import { Usage } from '../services/usage/usage';
import { Limits } from '../services/plans/limits';
import type { CoachingIntent } from '../services/journal/journalTypes';

export const journalController = {
  createEntry: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { symbol, direction, entry_price, exit_price, notes } = req.body;

    const entry = await JournalEntry.create({
      userId,
      symbol,
      direction,
      entryPrice: entry_price,
      exitPrice: exit_price ?? null,
      notes: notes ?? null,
    });

    return res.status(201).json(entry);
  },

  analyze: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await Usage.ensureDailyRow(userId);
    const plan = await Usage.getPlan(userId);
    const { analysesToday } = await Usage.getCounters(userId);
    if (plan === 'free' && analysesToday >= Limits.free.maxAnalysesPerDay) {
      return res
        .status(402)
        .json({ error: 'Free plan daily analysis limit reached. Upgrade to Pro.' });
    }

    const { symbol, direction, entry_price, exit_price, notes } = req.body;
    const analysis = await journalCoachLegacy.analyze({
      symbol,
      direction,
      entry: entry_price,
      exit: exit_price,
      notes,
    });

    const entry = await JournalEntry.create({
      userId,
      symbol,
      direction,
      entryPrice: entry_price,
      exitPrice: exit_price ?? null,
      notes: notes ?? null,
      aiFeedback: analysis,
    });

    await Usage.inc(userId, 'analysesToday');
    return res.json(analysis);
  },

  /**
   * Get journal analysis context for a user.
   * Returns structured analysis data for dashboards or programmatic access.
   */
  getAnalysis: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const targetUserId = req.params.userId;

    // Users can only access their own analysis (or admin check could be added)
    if (targetUserId !== userId) {
      return res.status(403).json({ error: 'Forbidden: Cannot access other users\' analysis' });
    }

    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const maxTrades = req.query.maxTrades ? parseInt(req.query.maxTrades as string, 10) : undefined;
      const coachingIntent = req.query.coachingIntent as CoachingIntent | undefined;

      const context = await journalService.buildJournalContext({
        userId: targetUserId,
        from,
        to,
        maxTrades,
        coachingIntent,
      });

      return res.json(context);
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to build journal analysis',
        message: (error as Error).message,
      });
    }
  },

  /**
   * Generate coaching response for journal analysis.
   */
  coaching: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await Usage.ensureDailyRow(userId);
    const plan = await Usage.getPlan(userId);
    const { analysesToday } = await Usage.getCounters(userId);
    if (plan === 'free' && analysesToday >= Limits.free.maxAnalysesPerDay) {
      return res
        .status(402)
        .json({ error: 'Free plan daily analysis limit reached. Upgrade to Pro.' });
    }

    const { message, coachingIntent = 'overview' } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    try {
      const response = await journalCoach.handleCoachingRequest({
        userId,
        message,
        coachingIntent: coachingIntent as CoachingIntent,
      });

      await Usage.inc(userId, 'analysesToday');
      return res.json(response);
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to generate coaching response',
        message: (error as Error).message,
      });
    }
  },

  /** GET /journal/dashboard/summary - Summary tab: net P&L, win rate, monthly charts, recent activity, win/loss stats, position status */
  getDashboardSummary: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const data = await journalDashboardService.getSummary(userId);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load journal summary', message: (e as Error).message });
    }
  },

  /** GET /journal/dashboard/trades/calendar?year=YYYY&month=M - Trades tab: calendar data (trade count + P&L per day) */
  getDashboardCalendar: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const year = req.query.year ? parseInt(String(req.query.year), 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(String(req.query.month), 10) : new Date().getMonth() + 1;
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    try {
      const data = await journalDashboardService.getCalendarMonth(userId, year, month);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load calendar', message: (e as Error).message });
    }
  },

  /** GET /journal/dashboard/trades/day?date=YYYY-MM-DD - Trades tab: table of trades for a single day */
  getDashboardDayTrades: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const dateStr = String(req.query.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'Invalid date; use YYYY-MM-DD' });
    }
    try {
      const data = await journalDashboardService.getDayTrades(userId, dateStr);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load day trades', message: (e as Error).message });
    }
  },

  /** GET /journal/dashboard/performance - Performance tab: risk metrics, performance summary */
  getDashboardPerformance: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const data = await journalDashboardService.getPerformance(userId);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load performance', message: (e as Error).message });
    }
  },
};
