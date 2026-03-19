/**
 * In-memory journal aggregates for streaming: per-user running totals and PnL list,
 * updated from streamed deals/positions. Used to build journal_summary and journal_performance
 * without re-querying full history.
 */

import { MetaApiAccount } from '../db/models/MetaApiAccount';
import { TradeHistory } from '../db/models/TradeHistory';
import { TradingPosition } from '../db/models/TradingPosition';
import { mapTradeHistoryToAnalyzable } from '../services/journal/journalAnalytics';
import type {
  JournalSummaryResponse,
  JournalPerformanceResponse,
} from '../services/journal/journalDashboardService';
import { journalDashboardService } from '../services/journal/journalDashboardService';
import type { AnalyzableTrade } from '../services/journal/journalTypes';
import { journalService } from '../services/journal/journalService';
import { getOpenPositions } from '../services/brokers/metaapi';
import { logger } from '../config/logger';

const PNL_LIST_CAP = 10_000;
/** Within this window we count at most one trade per positionId; further exit deals for same position only add PnL */
const RECENT_EXIT_DEDUPE_MS = 60_000;

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
  /** positionId -> timestamp when we counted it as one trade; used to dedupe multiple exit deals per close */
  recentExitByPositionId: Map<string, number>;
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
    recentExitByPositionId: new Map(),
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

const EXIT_ENTRY_TYPES = new Set(['DEAL_ENTRY_OUT', 'DEAL_ENTRY_OUT_BY']);

/**
 * Apply a streamed deal. Only exit deals (DEAL_ENTRY_OUT / DEAL_ENTRY_OUT_BY) count as one
 * closed trade; other deals are ignored. Multiple exit deals for the same position (e.g. main
 * + commission/swap) are deduped by positionId: only the first within RECENT_EXIT_DEDUPE_MS
 * counts as one trade; later ones only add PnL.
 * Deals that closed before primedAt are skipped (already included in the prime).
 */
export function applyDeal(
  userId: string,
  deal: Record<string, unknown>,
  _accountId: string
): void {
  const entryType = String(deal.entryType ?? '').toUpperCase();
  if (!EXIT_ENTRY_TYPES.has(entryType)) return;

  const state = getOrCreateAggregates(userId);

  if (state.primedAt != null) {
    const dealTimeMs =
      deal.time == null
        ? 0
        : typeof deal.time === 'string'
          ? new Date(deal.time).getTime()
          : Number(deal.time);
    if (dealTimeMs < state.primedAt) return;
    if (deal.time == null) return;
  }

  if (!state.recentExitByPositionId) state.recentExitByPositionId = new Map();
  const profit = Number(deal.profit ?? 0);
  const commission = Number(deal.commission ?? 0);
  const swap = Number(deal.swap ?? 0);
  const realizedPnl = profit - commission - swap;

  const positionId = String(deal.positionId ?? deal.id ?? '');
  const nowMs = Date.now();
  for (const [pid, ts] of state.recentExitByPositionId.entries()) {
    if (nowMs - ts > RECENT_EXIT_DEDUPE_MS) state.recentExitByPositionId.delete(pid);
  }

  const alreadyCounted = positionId && state.recentExitByPositionId.has(positionId);

  state.netPnl += realizedPnl;
  if (deal.time != null) {
    const dealTime =
      typeof deal.time === 'string' ? new Date(deal.time) : new Date(Number(deal.time));
    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (dealTime >= day7) state.pnlLast7Days += realizedPnl;
    if (dealTime >= day30) state.pnlLast30Days += realizedPnl;
    if (dealTime >= startOfMonth) state.pnlCurrentMonth += realizedPnl;
  }

  if (alreadyCounted) return;

  if (positionId) state.recentExitByPositionId.set(positionId, nowMs);
  state.totalTrades += 1;
  if (realizedPnl > 0) state.winningTrades += 1;
  else if (realizedPnl < 0) state.losingTrades += 1;
  else state.breakevenTrades += 1;

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
      if (!entry || !exit) continue;
      const t = mapTradeHistoryToAnalyzable(entry, exit, userId);
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

const DEFAULT_WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Prime from the same source as the REST dashboard summary and return that summary.
 * The first WebSocket journal_summary message will then match GET /journal/dashboard/summary.
 * Fetches per-account position counts for stream updates and fills pnlList from getTradesForWindow (cached).
 */
export async function primeFromDashboardSummary(
  userId: string
): Promise<JournalSummaryResponse | null> {
  let summary: JournalSummaryResponse;
  try {
    summary = await journalDashboardService.getSummary(userId);
  } catch (e) {
    logger.warn('primeFromDashboardSummary: getSummary failed', {
      userId,
      err: (e as Error)?.message,
    });
    return null;
  }

  const state = getOrCreateAggregates(userId);
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_WINDOW_MS);

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
  state.openPositionsCount = summary.positionStatus.openPositions;

  state.netPnl = summary.netPnl;
  state.totalTrades = summary.totalTrades;
  state.winningTrades = summary.winLossStats.winningTrades;
  state.losingTrades = summary.winLossStats.losingTrades;
  state.breakevenTrades = summary.winLossStats.breakevenTrades;
  state.pnlLast7Days = summary.recentActivity.pnlLast7Days;
  state.pnlLast30Days = summary.recentActivity.pnlLast30Days;
  state.pnlCurrentMonth = summary.recentActivity.pnlCurrentMonth;
  state.monthlyPnl = [...summary.monthlyPnl];
  state.monthlyWinRate = [...summary.monthlyWinRate];

  try {
    const trades = await journalService.getTradesForWindow({ userId, from, to });
    state.pnlList = trades.map((t) => t.realizedPnlUsd);
    if (state.pnlList.length > PNL_LIST_CAP) {
      state.pnlList = state.pnlList.slice(-PNL_LIST_CAP);
    }
  } catch {
    state.pnlList = [];
  }

  state.primedAt = Date.now();
  logger.debug('primeFromDashboardSummary', {
    userId,
    totalTrades: state.totalTrades,
    openPositions: state.openPositionsCount,
  });
  return summary;
}

/**
 * Prime in-memory journal aggregates using the same full calculation as the dashboard
 * (journalService.getTradesForWindow + getOpenPositionsCount, then same metrics).
 * Use as fallback when primeFromDashboardSummary fails.
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
