/**
 * In-memory journal aggregates for streaming: per-user running totals and PnL list,
 * updated from streamed deals/positions. Used to build journal_summary and journal_performance
 * without re-querying full history.
 */

import { MetaApiAccount } from '../db/models/MetaApiAccount.js';
import { TradeHistory } from '../db/models/TradeHistory.js';
import { TradingPosition } from '../db/models/TradingPosition.js';
import { mapTradeHistoryToAnalyzable } from '../services/journal/journalAnalytics.js';
import type {
  JournalSummaryResponse,
  JournalPerformanceResponse,
} from '../services/journal/journalDashboardService.js';
import type { AnalyzableTrade } from '../services/journal/journalTypes.js';
import { journalService } from '../services/journal/journalService.js';
import { getOpenPositions } from '../services/brokers/metaapi.js';
import { logger } from '../config/logger.js';

const PNL_LIST_CAP = 10_000;

export interface JournalAggregateState {
  netPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  openPositionsCount: number;
  pnlLast7Days: number;
  pnlLast30Days: number;
  pnlCurrentMonth: number;
  pnlList: number[];
  /** Per accountId (metaapiAccountId) position count; summed for openPositionsCount */
  perAccountPositionCount: Map<string, number>;
  /** Set during prime; empty when stream-only */
  monthlyPnl: Array<{ month: string; pnl: number }>;
  monthlyWinRate: Array<{ month: string; winRate: number }>;
  /** When the state was last primed (full calculation); stream events increment from this baseline */
  primedAt?: number;
}

const aggregatesByUserId = new Map<string, JournalAggregateState>();

function createEmptyState(): JournalAggregateState {
  return {
    netPnl: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakevenTrades: 0,
    openPositionsCount: 0,
    pnlLast7Days: 0,
    pnlLast30Days: 0,
    pnlCurrentMonth: 0,
    pnlList: [],
    perAccountPositionCount: new Map(),
    monthlyPnl: [],
    monthlyWinRate: [],
  };
}

export function getOrCreateAggregates(userId: string): JournalAggregateState {
  let state = aggregatesByUserId.get(userId);
  if (!state) {
    state = createEmptyState();
    aggregatesByUserId.set(userId, state);
  }
  return state;
}

export function hasAggregates(userId: string): boolean {
  return aggregatesByUserId.has(userId);
}

/** Check if state has been primed (full calculation run and primedAt set). */
export function isPrimed(userId: string): boolean {
  const state = aggregatesByUserId.get(userId);
  return state != null && state.primedAt != null;
}

/** Streamed deal payload: at least profit, optional commission, swap, time (ISO or ms). */
export function applyDeal(
  userId: string,
  deal: Record<string, unknown>,
  _accountId: string
): void {
  const state = getOrCreateAggregates(userId);
  const profit = Number(deal.profit ?? 0);
  const commission = Number(deal.commission ?? 0);
  const swap = Number(deal.swap ?? 0);
  const realizedPnl = profit - commission - swap;

  state.netPnl += realizedPnl;
  state.totalTrades += 1;
  if (realizedPnl > 0) state.winningTrades += 1;
  else if (realizedPnl < 0) state.losingTrades += 1;
  else state.breakevenTrades += 1;

  let dealTime: Date | null = null;
  const t = deal.time;
  if (t != null) {
    if (typeof t === 'string') dealTime = new Date(t);
    else if (typeof t === 'number') dealTime = new Date(t);
  }
  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (dealTime) {
    if (dealTime >= day7) state.pnlLast7Days += realizedPnl;
    if (dealTime >= day30) state.pnlLast30Days += realizedPnl;
    if (dealTime >= startOfMonth) state.pnlCurrentMonth += realizedPnl;
  }

  state.pnlList.push(realizedPnl);
  if (state.pnlList.length > PNL_LIST_CAP) {
    state.pnlList = state.pnlList.slice(-PNL_LIST_CAP);
  }
}

/** Set open position count for one account; openPositionsCount is sum across all accounts for this user. */
export function setAccountPositionCount(userId: string, accountId: string, count: number): void {
  const state = getOrCreateAggregates(userId);
  state.perAccountPositionCount.set(accountId, count);
  state.openPositionsCount = Array.from(state.perAccountPositionCount.values()).reduce(
    (s, n) => s + n,
    0
  );
}

/** Compute performance metrics from a list of realized PnLs (ordered by close time). */
export function computePerformanceFromPnlList(pnlList: number[]): {
  maxDrawdownPct: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  winRate: number | null;
} {
  if (pnlList.length === 0) {
    return {
      maxDrawdownPct: null,
      avgWin: null,
      avgLoss: null,
      bestTrade: null,
      worstTrade: null,
      winRate: null,
    };
  }

  const winners = pnlList.filter((p) => p > 0);
  const losers = pnlList.filter((p) => p < 0);
  const winRate =
    pnlList.length > 0 ? (winners.length / pnlList.length) * 100 : null;
  const avgWin = winners.length > 0 ? winners.reduce((s, p) => s + p, 0) / winners.length : null;
  const avgLoss =
    losers.length > 0 ? Math.abs(losers.reduce((s, p) => s + p, 0) / losers.length) : null;
  const bestTrade = Math.max(...pnlList);
  const worstTrade = Math.min(...pnlList);

  let maxDrawdownPct: number | null = null;
  if (pnlList.length >= 2) {
    let cumulativePnL = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const pnl of pnlList) {
      cumulativePnL += pnl;
      if (cumulativePnL > peak) peak = cumulativePnL;
      const drawdown = peak - cumulativePnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    const baseline = Math.max(peak, 1);
    maxDrawdownPct = (maxDrawdown / baseline) * 100;
  }

  return {
    maxDrawdownPct,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
    winRate,
  };
}

export function buildSummaryResponse(userId: string): JournalSummaryResponse {
  const state = getOrCreateAggregates(userId);
  const winRate =
    state.totalTrades > 0
      ? (state.winningTrades / state.totalTrades) * 100
      : null;
  return {
    netPnl: state.netPnl,
    totalTrades: state.totalTrades,
    winRate,
    monthlyPnl: state.monthlyPnl.length > 0 ? state.monthlyPnl : [],
    monthlyWinRate: state.monthlyWinRate.length > 0 ? state.monthlyWinRate : [],
    recentActivity: {
      pnlLast7Days: state.pnlLast7Days,
      pnlLast30Days: state.pnlLast30Days,
      pnlCurrentMonth: state.pnlCurrentMonth,
    },
    winLossStats: {
      winningTrades: state.winningTrades,
      losingTrades: state.losingTrades,
      breakevenTrades: state.breakevenTrades,
    },
    positionStatus: {
      openPositions: state.openPositionsCount,
      closedPositions: state.totalTrades,
      partiallyClosedPositions: 0,
    },
  };
}

export function buildPerformanceResponse(userId: string): JournalPerformanceResponse {
  const state = getOrCreateAggregates(userId);
  const perf = computePerformanceFromPnlList(state.pnlList);
  return {
    riskMetrics: {
      maxDrawdown: perf.maxDrawdownPct,
      avgWin: perf.avgWin,
      avgLoss: perf.avgLoss,
    },
    performanceSummary: {
      winRate: perf.winRate,
      bestTrade: perf.bestTrade,
      worstTrade: perf.worstTrade,
    },
  };
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Prime in-memory journal aggregates from DB (TradeHistory + TradingPosition).
 * Call when user first subscribes to journal or when state is empty after restart.
 */
export async function primeJournalAggregatesFromDb(userId: string): Promise<boolean> {
  const accounts = await MetaApiAccount.findAll({
    where: { userId },
    attributes: ['id', 'metaapiAccountId'],
  });
  if (accounts.length === 0) {
    return false;
  }

  const state = getOrCreateAggregates(userId);
  state.perAccountPositionCount.clear();
  state.netPnl = 0;
  state.totalTrades = 0;
  state.winningTrades = 0;
  state.losingTrades = 0;
  state.breakevenTrades = 0;
  state.pnlLast7Days = 0;
  state.pnlLast30Days = 0;
  state.pnlCurrentMonth = 0;
  state.pnlList = [];
  state.monthlyPnl = [];
  state.monthlyWinRate = [];

  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const byMonth = new Map<string, { pnl: number; wins: number; count: number }>();

  for (const acc of accounts) {
    const accountId = acc.id;
    const metaapiAccountId = acc.metaapiAccountId as string;

    const openCount = await TradingPosition.count({ where: { accountId } });
    state.perAccountPositionCount.set(metaapiAccountId, openCount);

    const rows = await TradeHistory.findAll({
      where: { accountId },
      order: [['time', 'ASC']],
    });

    const byPosition = new Map<string, { entry?: typeof TradeHistory.prototype; exit?: typeof TradeHistory.prototype }>();
    for (const row of rows) {
      const posId = row.positionId ?? row.id?.toString() ?? '';
      if (!byPosition.has(posId)) byPosition.set(posId, {});
      const slot = byPosition.get(posId)!;
      const entryType = (row.entryType ?? '').toUpperCase();
      if (entryType === 'DEAL_ENTRY_IN' || entryType === 'DEAL_ENTRY_INOUT') {
        if (!slot.entry || (row.time && slot.entry.time && row.time < slot.entry.time)) {
          slot.entry = row;
        }
      } else if (entryType === 'DEAL_ENTRY_OUT' || entryType === 'DEAL_ENTRY_OUT_BY') {
        if (!slot.exit || (row.time && slot.exit.time && row.time > slot.exit.time)) {
          slot.exit = row;
        }
      }
    }

    const trades: AnalyzableTrade[] = [];
    for (const { entry, exit } of byPosition.values()) {
      if (!entry) continue;
      const t = mapTradeHistoryToAnalyzable(entry, exit ?? undefined, userId);
      if (t) trades.push(t);
    }
    trades.sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));

    for (const t of trades) {
      state.netPnl += t.realizedPnlUsd;
      state.totalTrades += 1;
      if (t.realizedPnlUsd > 0) state.winningTrades += 1;
      else if (t.realizedPnlUsd < 0) state.losingTrades += 1;
      else state.breakevenTrades += 1;
      if (t.closedAt) {
        if (t.closedAt >= day7) state.pnlLast7Days += t.realizedPnlUsd;
        if (t.closedAt >= day30) state.pnlLast30Days += t.realizedPnlUsd;
        if (t.closedAt >= startOfMonth) state.pnlCurrentMonth += t.realizedPnlUsd;
        const key = monthKey(t.closedAt);
        const cur = byMonth.get(key) ?? { pnl: 0, wins: 0, count: 0 };
        cur.pnl += t.realizedPnlUsd;
        cur.count += 1;
        if (t.realizedPnlUsd > 0) cur.wins += 1;
        byMonth.set(key, cur);
      }
      state.pnlList.push(t.realizedPnlUsd);
      if (state.pnlList.length > PNL_LIST_CAP) {
        state.pnlList = state.pnlList.slice(-PNL_LIST_CAP);
      }
    }
  }

  state.openPositionsCount = Array.from(state.perAccountPositionCount.values()).reduce(
    (s, n) => s + n,
    0
  );

  const months = Array.from(byMonth.keys()).sort();
  state.monthlyPnl = months.map((month) => ({
    month,
    pnl: byMonth.get(month)!.pnl,
  }));
  state.monthlyWinRate = months.map((month) => {
    const cur = byMonth.get(month)!;
    return { month, winRate: cur.count > 0 ? (cur.wins / cur.count) * 100 : 0 };
  });

  state.primedAt = Date.now();
  logger.debug('primeJournalAggregatesFromDb', {
    userId,
    totalTrades: state.totalTrades,
    openPositions: state.openPositionsCount,
    primedAt: state.primedAt,
  });
  return state.totalTrades > 0 || state.openPositionsCount > 0;
}

/**
 * Prime in-memory journal aggregates using the same full calculation as the dashboard
 * (journalService.getTradesForWindow + getOpenPositionsCount, then same metrics).
 * Use this as the primary prime so PnL, max drawdown, positions, etc. match the dashboard.
 * State is stored with primedAt; stream events then increment from this baseline.
 */
export async function primeJournalAggregatesFromRest(userId: string): Promise<boolean> {
  const state = getOrCreateAggregates(userId);
  const to = new Date();
  const from = new Date(to.getTime() - 730 * 24 * 60 * 60 * 1000); // ~2 years
  let trades: AnalyzableTrade[];
  try {
    trades = await journalService.getTradesForWindow({ userId, from, to, maxTrades: 2000 });
  } catch (e) {
    logger.warn('primeJournalAggregatesFromRest: getTradesForWindow failed', {
      userId,
      err: (e as Error)?.message,
    });
    return false;
  }

  const accounts = await MetaApiAccount.findAll({
    where: { userId },
    attributes: ['metaapiAccountId'],
  });
  state.perAccountPositionCount.clear();
  for (const acc of accounts) {
    const metaapiAccountId = acc.metaapiAccountId as string;
    try {
      const positions = await getOpenPositions(metaapiAccountId);
      state.perAccountPositionCount.set(metaapiAccountId, Array.isArray(positions) ? positions.length : 0);
    } catch {
      state.perAccountPositionCount.set(metaapiAccountId, 0);
    }
  }
  state.openPositionsCount = Array.from(state.perAccountPositionCount.values()).reduce((s, n) => s + n, 0);

  state.netPnl = 0;
  state.totalTrades = 0;
  state.winningTrades = 0;
  state.losingTrades = 0;
  state.breakevenTrades = 0;
  state.pnlLast7Days = 0;
  state.pnlLast30Days = 0;
  state.pnlCurrentMonth = 0;
  state.pnlList = [];
  state.monthlyPnl = [];
  state.monthlyWinRate = [];

  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const byMonth = new Map<string, { pnl: number; wins: number; count: number }>();

  trades.sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));

  for (const t of trades) {
    state.netPnl += t.realizedPnlUsd;
    state.totalTrades += 1;
    if (t.realizedPnlUsd > 0) state.winningTrades += 1;
    else if (t.realizedPnlUsd < 0) state.losingTrades += 1;
    else state.breakevenTrades += 1;
    if (t.closedAt) {
      if (t.closedAt >= day7) state.pnlLast7Days += t.realizedPnlUsd;
      if (t.closedAt >= day30) state.pnlLast30Days += t.realizedPnlUsd;
      if (t.closedAt >= startOfMonth) state.pnlCurrentMonth += t.realizedPnlUsd;
      const key = monthKey(t.closedAt);
      const cur = byMonth.get(key) ?? { pnl: 0, wins: 0, count: 0 };
      cur.pnl += t.realizedPnlUsd;
      cur.count += 1;
      if (t.realizedPnlUsd > 0) cur.wins += 1;
      byMonth.set(key, cur);
    }
    state.pnlList.push(t.realizedPnlUsd);
    if (state.pnlList.length > PNL_LIST_CAP) {
      state.pnlList = state.pnlList.slice(-PNL_LIST_CAP);
    }
  }

  const months = Array.from(byMonth.keys()).sort();
  state.monthlyPnl = months.map((month) => ({
    month,
    pnl: byMonth.get(month)!.pnl,
  }));
  state.monthlyWinRate = months.map((month) => {
    const cur = byMonth.get(month)!;
    return { month, winRate: cur.count > 0 ? (cur.wins / cur.count) * 100 : 0 };
  });

  state.primedAt = Date.now();
  logger.debug('primeJournalAggregatesFromRest', {
    userId,
    totalTrades: state.totalTrades,
    openPositions: state.openPositionsCount,
    primedAt: state.primedAt,
  });
  return state.totalTrades > 0 || state.openPositionsCount > 0;
}
