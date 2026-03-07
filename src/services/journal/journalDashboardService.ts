import { Op } from 'sequelize';
import { MetaApiAccount } from '../../db/models/MetaApiAccount.js';
import { TradingPosition } from '../../db/models/TradingPosition.js';
import { journalService } from './journalService.js';
import { computeWinRate, computeMaxDrawdownPct } from './journalAnalytics.js';

const DEFAULT_WINDOW_YEARS = 2;
const DEFAULT_WINDOW_MS = DEFAULT_WINDOW_YEARS * 365 * 24 * 60 * 60 * 1000;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface JournalSummaryResponse {
  netPnl: number;
  totalTrades: number;
  winRate: number | null;
  monthlyPnl: Array<{ month: string; pnl: number }>;
  monthlyWinRate: Array<{ month: string; winRate: number }>;
  recentActivity: {
    pnlLast7Days: number;
    pnlLast30Days: number;
    pnlCurrentMonth: number;
  };
  winLossStats: {
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
  };
  positionStatus: {
    openPositions: number;
    closedPositions: number;
    partiallyClosedPositions: number;
  };
}

export interface CalendarDayResponse {
  date: string;
  tradeCount: number;
  pnl: number;
}

export interface DayTradeRowResponse {
  date: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  entry: number;
  exit: number;
  status: string;
  risk: number | null;
  pnl: number;
}

export interface JournalPerformanceResponse {
  riskMetrics: {
    maxDrawdown: number | null;
    avgWin: number | null;
    avgLoss: number | null;
  };
  performanceSummary: {
    winRate: number | null;
    bestTrade: number | null;
    worstTrade: number | null;
  };
}

export const journalDashboardService = {
  async getSummary(userId: string): Promise<JournalSummaryResponse> {
    const to = new Date();
    const from = new Date(to.getTime() - DEFAULT_WINDOW_MS);
    const trades = await journalService.getTradesForWindow({ userId, from, to });
    const accountIds = (await MetaApiAccount.findAll({ where: { userId }, attributes: ['id'] })).map((a) => a.id);
    const openPositionsCount =
      accountIds.length === 0 ? 0 : await TradingPosition.count({ where: { accountId: { [Op.in]: accountIds } } });

    const netPnl = trades.reduce((sum, t) => sum + t.realizedPnlUsd, 0);
    const winRate = computeWinRate(trades);
    const winningTrades = trades.filter((t) => t.realizedPnlUsd > 0).length;
    const losingTrades = trades.filter((t) => t.realizedPnlUsd < 0).length;
    const breakevenTrades = trades.filter((t) => t.realizedPnlUsd === 0).length;

    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const pnlLast7Days = trades
      .filter((t) => t.closedAt && t.closedAt >= day7)
      .reduce((s, t) => s + t.realizedPnlUsd, 0);
    const pnlLast30Days = trades
      .filter((t) => t.closedAt && t.closedAt >= day30)
      .reduce((s, t) => s + t.realizedPnlUsd, 0);
    const pnlCurrentMonth = trades
      .filter((t) => t.closedAt && t.closedAt >= startOfThisMonth)
      .reduce((s, t) => s + t.realizedPnlUsd, 0);

    const byMonth = new Map<string, { pnl: number; wins: number; count: number }>();
    for (const t of trades) {
      if (!t.closedAt) continue;
      const key = monthKey(t.closedAt);
      const cur = byMonth.get(key) ?? { pnl: 0, wins: 0, count: 0 };
      cur.pnl += t.realizedPnlUsd;
      cur.count += 1;
      if (t.realizedPnlUsd > 0) cur.wins += 1;
      byMonth.set(key, cur);
    }
    const months = Array.from(byMonth.keys()).sort();
    const monthlyPnl = months.map((month) => ({
      month,
      pnl: byMonth.get(month)!.pnl,
    }));
    const monthlyWinRate = months.map((month) => {
      const cur = byMonth.get(month)!;
      return { month, winRate: cur.count > 0 ? (cur.wins / cur.count) * 100 : 0 };
    });

    return {
      netPnl,
      totalTrades: trades.length,
      winRate,
      monthlyPnl,
      monthlyWinRate,
      recentActivity: { pnlLast7Days, pnlLast30Days, pnlCurrentMonth },
      winLossStats: { winningTrades, losingTrades, breakevenTrades },
      positionStatus: {
        openPositions: openPositionsCount,
        closedPositions: trades.length,
        partiallyClosedPositions: 0,
      },
    };
  },

  async getCalendarMonth(userId: string, year: number, month: number): Promise<CalendarDayResponse[]> {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const trades = await journalService.getTradesForWindow({ userId, from: start, to: end });
    const byDay = new Map<string, { count: number; pnl: number }>();
    for (const t of trades) {
      if (!t.closedAt) continue;
      const key = dateKey(t.closedAt);
      const cur = byDay.get(key) ?? { count: 0, pnl: 0 };
      cur.count += 1;
      cur.pnl += t.realizedPnlUsd;
      byDay.set(key, cur);
    }
    const daysInMonth = new Date(year, month, 0).getDate();
    const result: CalendarDayResponse[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(year, month - 1, day));
      const key = dateKey(d);
      const cur = byDay.get(key);
      result.push({
        date: key,
        tradeCount: cur?.count ?? 0,
        pnl: cur?.pnl ?? 0,
      });
    }
    return result;
  },

  async getDayTrades(userId: string, dateStr: string): Promise<DayTradeRowResponse[]> {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayStart = new Date(Date.UTC(y, m - 1, d));
    const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    const trades = await journalService.getTradesForWindow({
      userId,
      from: dayStart,
      to: dayEnd,
      maxTrades: 500,
    });
    return trades.map((t) => {
      const risk =
        t.stopPrice != null && t.quantity > 0
          ? Math.abs(t.entryPrice - t.stopPrice) * t.quantity
          : null;
      return {
        date: t.closedAt ? t.closedAt.toISOString() : dateStr,
        symbol: t.symbol,
        type: t.side === 'long' ? 'Buy' : 'Sell',
        entry: t.entryPrice,
        exit: t.exitPrice ?? 0,
        status: 'Closed',
        risk,
        pnl: t.realizedPnlUsd,
      };
    });
  },

  async getPerformance(userId: string): Promise<JournalPerformanceResponse> {
    const to = new Date();
    const from = new Date(to.getTime() - DEFAULT_WINDOW_MS);
    const trades = await journalService.getTradesForWindow({ userId, from, to });
    const winRate = computeWinRate(trades);
    const maxDrawdown = computeMaxDrawdownPct(trades);
    const winners = trades.filter((t) => t.realizedPnlUsd > 0);
    const losers = trades.filter((t) => t.realizedPnlUsd < 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.realizedPnlUsd, 0) / winners.length : null;
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.realizedPnlUsd, 0) / losers.length : null;
    const pnls = trades.map((t) => t.realizedPnlUsd);
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : null;
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : null;

    return {
      riskMetrics: {
        maxDrawdown,
        avgWin,
        avgLoss: avgLoss !== null ? Math.abs(avgLoss) : null,
      },
      performanceSummary: {
        winRate,
        bestTrade,
        worstTrade,
      },
    };
  },
};
