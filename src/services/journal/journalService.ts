import { JournalEntry } from '../../db/models/JournalEntry.js';
import { MetaApiAccount } from '../../db/models/MetaApiAccount.js';
import { getUserProfileMetrics } from '../profile/profileService.js';
import {
  getHistoryDealsByTimeRange,
  getOpenPositions,
} from '../brokers/metaapi.js';
import {
  mapMetaApiDealPairToAnalyzable,
  computeWinRate,
  computeAvgRr,
  computeAvgPnlUsd,
  computeMedianRiskPerTradePct,
  computeMaxDrawdownPct,
  bucketTrades,
  detectBehaviourPatterns,
} from './journalAnalytics.js';
import type { MetaApiMetatraderDeal } from '../../types/metaapi.js';
import type {
  JournalAnalysisRequest,
  JournalContextForLLM,
  JournalDashboardSummary,
  JournalDashboardPerformance,
  AnalyzableTrade,
  JournalStatsBucket,
} from './journalTypes.js';

/**
 * Default configuration for journal analysis.
 */
const DEFAULT_CONFIG = {
  /** Default analysis window in days */
  DEFAULT_WINDOW_DAYS: 60,
  /** Maximum number of trades to analyze */
  MAX_TRADES: 500,
  /** Minimum trades required for meaningful analysis */
  MIN_TRADES_FOR_ANALYSIS: 30,
} as const;

/** In-memory cache for getTradesForWindow (MetaAPI). TTL 60s; source of truth remains MetaAPI. */
const TRADES_CACHE_TTL_MS = 60_000;
const tradesCache = new Map<
  string,
  { trades: AnalyzableTrade[]; expiresAt: number }
>();

function getTradesCacheKey(userId: string, from: Date, to: Date): string {
  return `trades:${userId}:${from.getTime()}:${to.getTime()}`;
}

/**
 * Group MetaAPI deals by positionId into entry (DEAL_ENTRY_IN) + exit (DEAL_ENTRY_OUT / DEAL_ENTRY_OUT_BY).
 * Only trading deals (DEAL_TYPE_BUY / DEAL_TYPE_SELL).
 */
function reconstructTradesFromMetaApiDeals(
  deals: MetaApiMetatraderDeal[]
): Array<{ entry: MetaApiMetatraderDeal; exit: MetaApiMetatraderDeal }> {
  const tradingTypes = ['DEAL_TYPE_BUY', 'DEAL_TYPE_SELL'];
  const entryTypes = ['DEAL_ENTRY_IN'];
  const exitTypes = ['DEAL_ENTRY_OUT', 'DEAL_ENTRY_OUT_BY'];
  const byPosition = new Map<
    string,
    { entry?: MetaApiMetatraderDeal; exit?: MetaApiMetatraderDeal }
  >();

  for (const deal of deals) {
    if (!tradingTypes.includes(deal.type)) continue;
    const posId = deal.positionId ?? deal.id;
    if (!byPosition.has(posId)) byPosition.set(posId, {});
    const slot = byPosition.get(posId)!;
    if (entryTypes.includes(deal.entryType ?? '')) {
      if (
        !slot.entry ||
        (deal.time && slot.entry.time && deal.time < slot.entry.time)
      )
        slot.entry = deal;
    } else if (exitTypes.includes(deal.entryType ?? '')) {
      if (
        !slot.exit ||
        (deal.time && slot.exit.time && deal.time > slot.exit.time)
      )
        slot.exit = deal;
    }
  }

  const pairs: Array<{ entry: MetaApiMetatraderDeal; exit: MetaApiMetatraderDeal }> = [];
  for (const { entry, exit } of byPosition.values()) {
    if (entry && exit) pairs.push({ entry, exit });
  }
  return pairs;
}

/**
 * Extract common themes from journal entry notes (simple keyword extraction).
 * TODO: Can be enhanced with LLM-based clustering in the future.
 */
function extractCommonThemes(entries: JournalEntry[]): string[] {
  const themes: string[] = [];
  const keywordMap = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.notes) continue;
    const lowerNotes = entry.notes.toLowerCase();

    // Simple keyword detection
    const keywords = [
      'fomo',
      'revenge',
      'overtrading',
      'discipline',
      'patience',
      'fear',
      'greed',
      'breakout',
      'reversal',
      'trend',
      'support',
      'resistance',
      'stop loss',
      'take profit',
      'risk management',
    ];

    for (const keyword of keywords) {
      if (lowerNotes.includes(keyword)) {
        keywordMap.set(keyword, (keywordMap.get(keyword) || 0) + 1);
      }
    }
  }

  // Return top 5 most common themes
  const sortedThemes = Array.from(keywordMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([keyword]) => keyword);

  return sortedThemes;
}

/**
 * Service for building journal analysis context from trades, journal entries, and profile metrics.
 */
export class JournalService {
  /**
   * Get reconstructed analyzable trades for a user and date window (for dashboard/aggregations).
   * Source of truth: MetaAPI. Results are cached for 60s for faster repeat requests.
   */
  async getTradesForWindow(req: {
    userId: string;
    from?: Date;
    to?: Date;
    maxTrades?: number;
  }): Promise<AnalyzableTrade[]> {
    const { userId, from, to, maxTrades = 2000 } = req;
    const now = new Date();
    const windowTo = to || now;
    const windowFrom =
      from ||
      new Date(windowTo.getTime() - 730 * 24 * 60 * 60 * 1000); // ~2 years

    const cacheKey = getTradesCacheKey(userId, windowFrom, windowTo);
    const cached = tradesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.trades.slice(0, maxTrades);
    }

    const trades = await this.getTradesForWindowFromMetaApi({
      userId,
      from: windowFrom,
      to: windowTo,
      maxTrades,
    });
    tradesCache.set(cacheKey, {
      trades,
      expiresAt: Date.now() + TRADES_CACHE_TTL_MS,
    });
    return trades;
  }

  /**
   * Fetch closed trades from MetaAPI (history deals) for all user accounts.
   * Source of truth; no DB read.
   */
  private async getTradesForWindowFromMetaApi(req: {
    userId: string;
    from: Date;
    to: Date;
    maxTrades: number;
  }): Promise<AnalyzableTrade[]> {
    const { userId, from, to, maxTrades } = req;
    const accounts = await MetaApiAccount.findAll({
      where: { userId },
      attributes: ['metaapiAccountId'],
    });
    if (accounts.length === 0) return [];

    const allDeals: MetaApiMetatraderDeal[] = [];
    for (const acc of accounts) {
      const metaapiAccountId = acc.metaapiAccountId as string;
      try {
        const deals = await getHistoryDealsByTimeRange(metaapiAccountId, from, to, {
          maxDeals: maxTrades * 3,
        });
        allDeals.push(...deals);
      } catch {
        // Skip account on failure (e.g. not connected)
      }
    }

    const pairs = reconstructTradesFromMetaApiDeals(allDeals);
    const analyzableTrades: AnalyzableTrade[] = [];
    const byClose = [...pairs].sort((a, b) => {
      const tA = a.exit.time ? new Date(a.exit.time).getTime() : 0;
      const tB = b.exit.time ? new Date(b.exit.time).getTime() : 0;
      return tB - tA;
    });
    for (const { entry, exit } of byClose) {
      if (analyzableTrades.length >= maxTrades) break;
      const t = mapMetaApiDealPairToAnalyzable(entry, exit, userId);
      if (t) analyzableTrades.push(t);
    }
    return analyzableTrades;
  }

  /** Count open positions across user's MetaAPI accounts (live from MetaAPI). */
  async getOpenPositionsCount(userId: string): Promise<number> {
    const accounts = await MetaApiAccount.findAll({
      where: { userId },
      attributes: ['metaapiAccountId'],
    });
    if (accounts.length === 0) return 0;
    const results = await Promise.allSettled(
      accounts.map((acc) => getOpenPositions(acc.metaapiAccountId as string))
    );
    let total = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) total += r.value.length;
    }
    return total;
  }

  /**
   * Build complete journal context for LLM consumption.
   * Source of truth for trades and open positions: MetaAPI. Trades are cached 60s.
   */
  async buildJournalContext(req: JournalAnalysisRequest): Promise<JournalContextForLLM> {
    const { userId, from, to, maxTrades = DEFAULT_CONFIG.MAX_TRADES } = req;

    // Resolve time window
    const now = new Date();
    const windowTo = to || now;
    const windowFrom =
      from ||
      new Date(windowTo.getTime() - DEFAULT_CONFIG.DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Trades from MetaAPI (cached 60s)
    const analyzableTrades = await this.getTradesForWindow({
      userId,
      from: windowFrom,
      to: windowTo,
      maxTrades,
    });

    const accounts = await MetaApiAccount.findAll({
      where: { userId },
      attributes: ['id'],
    });
    if (accounts.length === 0) {
      return this.buildEmptyContext(userId, windowFrom, windowTo);
    }

    // Load profile metrics
    const profileMetrics = await getUserProfileMetrics(userId);

    // Compute overall stats
    const overallStats: JournalStatsBucket = {
      key: {},
      tradeCount: analyzableTrades.length,
      winRatePct: computeWinRate(analyzableTrades),
      avgRr: computeAvgRr(analyzableTrades),
      avgPnlUsd: computeAvgPnlUsd(analyzableTrades),
      medianRiskPerTradePct: computeMedianRiskPerTradePct(analyzableTrades),
      maxDrawdownPct: computeMaxDrawdownPct(analyzableTrades),
    };

    // Bucket trades by various dimensions
    const bySymbol = bucketTrades(analyzableTrades, (t) => ({ symbol: t.symbol }));
    const bySession = bucketTrades(analyzableTrades, (t) => ({
      sessionLabel: t.sessionLabel || undefined,
    }));
    const byTimeframe = bucketTrades(analyzableTrades, (t) => ({
      timeframe: t.timeframe || undefined,
    }));
    const byStrategy = bucketTrades(analyzableTrades, (t) => ({
      strategyTag: t.strategyTag || undefined,
    }));

    // Detect behavioral patterns
    const behaviourPatterns = detectBehaviourPatterns(analyzableTrades, profileMetrics);

    // Load journal entries in time window
    const journalEntries = await JournalEntry.findAll({
      where: {
        userId,
        // JournalEntry doesn't have a timestamp field, so we'll match by symbol and approximate time
        // For now, just get all entries for the user (can be enhanced with timestamp field)
      },
      limit: 1000, // Reasonable limit
    });

    // Filter entries that might be related to trades in our window (by symbol matching)
    const tradeSymbols = new Set(analyzableTrades.map((t) => t.symbol));
    const relevantEntries = journalEntries.filter((entry) => tradeSymbols.has(entry.symbol));

    const notesSummary = {
      totalEntries: relevantEntries.length,
      commonThemes: extractCommonThemes(relevantEntries),
    };

    // Assess data quality
    const enoughTrades = analyzableTrades.length >= DEFAULT_CONFIG.MIN_TRADES_FOR_ANALYSIS;
    const missingFields: string[] = [];
    if (analyzableTrades.length === 0) {
      missingFields.push('no_trades');
    }
    if (!profileMetrics) {
      missingFields.push('no_profile_metrics');
    }
    if (
      analyzableTrades.filter((t) => t.realizedRr == null).length >
      analyzableTrades.length * 0.5
    ) {
      missingFields.push('incomplete_rr_data');
    }
    if (
      analyzableTrades.filter((t) => t.equityAtOpenUsd == null).length >
      analyzableTrades.length * 0.5
    ) {
      missingFields.push('incomplete_equity_data');
    }

    // Dashboard-style summary (scoped to analysis window)
    const netPnl = analyzableTrades.reduce((sum, t) => sum + t.realizedPnlUsd, 0);
    const winningTrades = analyzableTrades.filter((t) => t.realizedPnlUsd > 0).length;
    const losingTrades = analyzableTrades.filter((t) => t.realizedPnlUsd < 0).length;
    const breakevenTrades = analyzableTrades.filter((t) => t.realizedPnlUsd === 0).length;
    const day7 = new Date(windowTo.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day30 = new Date(windowTo.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(Date.UTC(windowTo.getUTCFullYear(), windowTo.getUTCMonth(), 1));
    const pnlLast7Days = analyzableTrades
      .filter((t) => t.closedAt && t.closedAt >= day7)
      .reduce((s, t) => s + t.realizedPnlUsd, 0);
    const pnlLast30Days = analyzableTrades
      .filter((t) => t.closedAt && t.closedAt >= day30)
      .reduce((s, t) => s + t.realizedPnlUsd, 0);
    const pnlCurrentMonth = analyzableTrades
      .filter((t) => t.closedAt && t.closedAt >= startOfMonth)
      .reduce((s, t) => s + t.realizedPnlUsd, 0);
    const byMonth = new Map<string, { pnl: number; wins: number; count: number }>();
    for (const t of analyzableTrades) {
      if (!t.closedAt) continue;
      const key = `${t.closedAt.getUTCFullYear()}-${String(t.closedAt.getUTCMonth() + 1).padStart(2, '0')}`;
      const cur = byMonth.get(key) ?? { pnl: 0, wins: 0, count: 0 };
      cur.pnl += t.realizedPnlUsd;
      cur.count += 1;
      if (t.realizedPnlUsd > 0) cur.wins += 1;
      byMonth.set(key, cur);
    }
    const months = Array.from(byMonth.keys()).sort();
    const monthlyPnl = months.map((month) => ({ month, pnl: byMonth.get(month)!.pnl }));
    const monthlyWinRate = months.map((month) => {
      const cur = byMonth.get(month)!;
      return { month, winRate: cur.count > 0 ? (cur.wins / cur.count) * 100 : 0 };
    });
    const openPositionsCount = await this.getOpenPositionsCount(userId);
    const dashboardSummary: JournalDashboardSummary = {
      netPnl,
      monthlyPnl,
      monthlyWinRate,
      recentActivity: { pnlLast7Days, pnlLast30Days, pnlCurrentMonth },
      winLossStats: { winningTrades, losingTrades, breakevenTrades },
      positionStatus: {
        openPositions: openPositionsCount,
        closedPositions: analyzableTrades.length,
        partiallyClosedPositions: 0,
      },
    };

    // Dashboard-style performance
    const winners = analyzableTrades.filter((t) => t.realizedPnlUsd > 0);
    const losers = analyzableTrades.filter((t) => t.realizedPnlUsd < 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.realizedPnlUsd, 0) / winners.length : null;
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.realizedPnlUsd, 0) / losers.length : null;
    const pnls = analyzableTrades.map((t) => t.realizedPnlUsd);
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : null;
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : null;
    const dashboardPerformance: JournalDashboardPerformance = {
      riskMetrics: {
        maxDrawdown: overallStats.maxDrawdownPct,
        avgWin,
        avgLoss: avgLoss !== null ? Math.abs(avgLoss) : null,
      },
      performanceSummary: {
        winRate: overallStats.winRatePct,
        bestTrade,
        worstTrade,
      },
    };

    return {
      userId,
      window: {
        from: windowFrom,
        to: windowTo,
        tradeCount: analyzableTrades.length,
      },
      overallStats,
      bySymbol,
      bySession,
      byTimeframe,
      byStrategy,
      behaviourPatterns,
      profileMetrics,
      notesSummary,
      dataQuality: {
        enoughTrades,
        tradesConsidered: analyzableTrades.length,
        missingFields,
      },
      dashboardSummary,
      dashboardPerformance,
    };
  }

  /**
   * Build empty context when user has no accounts or trades.
   */
  private buildEmptyContext(userId: string, from: Date, to: Date): JournalContextForLLM {
    return {
      userId,
      window: {
        from,
        to,
        tradeCount: 0,
      },
      overallStats: {
        key: {},
        tradeCount: 0,
        winRatePct: null,
        avgRr: null,
        avgPnlUsd: null,
        medianRiskPerTradePct: null,
        maxDrawdownPct: null,
      },
      bySymbol: [],
      bySession: [],
      byTimeframe: [],
      byStrategy: [],
      behaviourPatterns: [],
      profileMetrics: null,
      notesSummary: {
        totalEntries: 0,
        commonThemes: [],
      },
      dataQuality: {
        enoughTrades: false,
        tradesConsidered: 0,
        missingFields: ['no_trades', 'no_accounts'],
      },
      dashboardSummary: {
        netPnl: 0,
        monthlyPnl: [],
        monthlyWinRate: [],
        recentActivity: { pnlLast7Days: 0, pnlLast30Days: 0, pnlCurrentMonth: 0 },
        winLossStats: { winningTrades: 0, losingTrades: 0, breakevenTrades: 0 },
        positionStatus: { openPositions: 0, closedPositions: 0, partiallyClosedPositions: 0 },
      },
      dashboardPerformance: {
        riskMetrics: { maxDrawdown: null, avgWin: null, avgLoss: null },
        performanceSummary: { winRate: null, bestTrade: null, worstTrade: null },
      },
    };
  }
}

// Export singleton instance
export const journalService = new JournalService();
