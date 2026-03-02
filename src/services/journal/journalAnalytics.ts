import type { TradeHistory } from '../../db/models/TradeHistory.js';
import type { AnalyzableTrade, JournalStatsBucket, JournalStatsBucketKey, BehaviourPattern } from './journalTypes.js';
import type { UserProfileMetrics } from '../profile/profileTypes.js';

/**
 * Configuration thresholds for pattern detection.
 * These are configurable constants that determine when patterns are detected.
 */
const PATTERN_THRESHOLDS = {
  /** Minimum trades per day to consider overtrading */
  OVERTRADING_MIN_TRADES_PER_DAY: 5,
  /** Performance deterioration threshold (win rate drop > X%) */
  OVERTRADING_WIN_RATE_DROP_PCT: 10,
  /** Size increase factor after loss to detect revenge trading */
  REVENGE_TRADING_SIZE_INCREASE_FACTOR: 1.5,
  /** Coefficient of variation threshold for size inconsistency */
  SIZE_INCONSISTENCY_CV_THRESHOLD: 0.5,
  /** RR ratio below profile average by this factor to detect mismanagement */
  RR_MISMANAGEMENT_FACTOR: 0.7,
  /** Win rate difference between sessions to detect variation */
  SESSION_VARIATION_WIN_RATE_DIFF_PCT: 20,
  /** Minimum trades per symbol to consider symbol-specific edge */
  SYMBOL_EDGE_MIN_TRADES: 10,
  /** Win rate advantage for symbol-specific edge */
  SYMBOL_EDGE_WIN_RATE_ADVANTAGE_PCT: 15,
} as const;

/**
 * Timeframe inference based on trade duration (in hours).
 */
const TIMEFRAME_DURATION_HOURS = {
  SCALP: 1, // < 1 hour
  INTRADAY: 24, // < 24 hours
  SWING: 168, // < 1 week (7 days)
  POSITION: Infinity, // >= 1 week
} as const;

/**
 * Trading session hours (UTC) for session label inference.
 */
const SESSION_HOURS = {
  ASIA: { start: 0, end: 8 }, // 00:00 - 08:00 UTC
  LONDON: { start: 8, end: 16 }, // 08:00 - 16:00 UTC
  NY: { start: 13, end: 21 }, // 13:00 - 21:00 UTC
  OVERLAP: { start: 13, end: 16 }, // London-NY overlap
} as const;

/**
 * Map a TradeHistory record to AnalyzableTrade with journal-specific fields.
 * Extends the base AnalyzableTrade with computed fields for journal analysis.
 */
export function mapTradeHistoryToAnalyzable(
  entry: TradeHistory,
  exit: TradeHistory | undefined,
  userId: string
): AnalyzableTrade | null {
  const exitRecord = exit || entry;
  const timeOpen = entry.timeOpen;
  const timeClose = exitRecord.timeClose || entry.timeClose;

  if (!timeOpen || !timeClose) {
    return null;
  }

  // Determine side from dealType or type
  const dealType = entry.dealType || entry.type || '';
  const side: 'long' | 'short' =
    dealType.includes('BUY') || dealType.toLowerCase() === 'buy' ? 'long' : 'short';

  // Get prices
  let entryPrice = entry.price != null ? Number(entry.price) : 0;
  let exitPrice = exitRecord.price != null ? Number(exitRecord.price) : 0;

  // If exit price is missing but we have profit, try to infer it
  if (exitPrice <= 0 && entry.profit != null && entry.volume != null) {
    const profit = Number(entry.profit);
    const quantity = Number(entry.volume);
    if (quantity > 0) {
      if (side === 'long') {
        exitPrice = entryPrice + profit / quantity;
      } else {
        exitPrice = entryPrice - profit / quantity;
      }
    }
  }

  const quantity = entry.volume != null ? Number(entry.volume) : 0;
  const stopPrice = entry.stopLoss != null ? Number(entry.stopLoss) : null;
  const targetPrice = entry.takeProfit != null ? Number(entry.takeProfit) : null;

  if (entryPrice <= 0 || exitPrice <= 0 || quantity <= 0) {
    return null;
  }

  // Compute realized PnL
  let realizedPnlUsd: number;
  if (side === 'long') {
    realizedPnlUsd = (exitPrice - entryPrice) * quantity;
  } else {
    realizedPnlUsd = (entryPrice - exitPrice) * quantity;
  }

  // Add commission and swap if available
  if (entry.commission != null) {
    realizedPnlUsd -= Number(entry.commission);
  }
  if (entry.swap != null) {
    realizedPnlUsd -= Number(entry.swap);
  }

  // Compute realized RR
  let realizedRr: number | null = null;
  if (stopPrice != null && stopPrice > 0) {
    const riskUsd = Math.abs(entryPrice - stopPrice) * quantity;
    if (riskUsd > 0) {
      const rewardUsd = Math.abs(exitPrice - entryPrice) * quantity;
      realizedRr = rewardUsd / riskUsd;
    }
  }

  // Infer timeframe from duration
  const durationMs = timeClose.getTime() - timeOpen.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  let timeframe: string | null = null;
  if (durationHours < TIMEFRAME_DURATION_HOURS.SCALP) {
    timeframe = 'scalp';
  } else if (durationHours < TIMEFRAME_DURATION_HOURS.INTRADAY) {
    timeframe = 'intraday';
  } else if (durationHours < TIMEFRAME_DURATION_HOURS.SWING) {
    timeframe = 'swing';
  } else {
    timeframe = 'position';
  }

  // Infer session label from entry time (UTC)
  const entryHour = timeOpen.getUTCHours();
  let sessionLabel: string | null = null;
  if (entryHour >= SESSION_HOURS.OVERLAP.start && entryHour < SESSION_HOURS.OVERLAP.end) {
    sessionLabel = 'Overlap';
  } else if (entryHour >= SESSION_HOURS.LONDON.start && entryHour < SESSION_HOURS.LONDON.end) {
    sessionLabel = 'London';
  } else if (entryHour >= SESSION_HOURS.NY.start && entryHour < SESSION_HOURS.NY.end) {
    sessionLabel = 'NY';
  } else if (entryHour >= SESSION_HOURS.ASIA.start && entryHour < SESSION_HOURS.ASIA.end) {
    sessionLabel = 'Asia';
  } else {
    sessionLabel = 'Other';
  }

  // Extract strategy tag from comment (simple heuristic - can be enhanced)
  let strategyTag: string | null = null;
  const comment = entry.comment || entry.brokerComment || '';
  if (comment) {
    // Simple keyword extraction (can be enhanced with LLM later)
    const lowerComment = comment.toLowerCase();
    if (lowerComment.includes('breakout') || lowerComment.includes('break')) {
      strategyTag = 'breakout';
    } else if (lowerComment.includes('reversal') || lowerComment.includes('reversal')) {
      strategyTag = 'reversal';
    } else if (lowerComment.includes('trend') || lowerComment.includes('momentum')) {
      strategyTag = 'trend';
    } else if (lowerComment.includes('scalp')) {
      strategyTag = 'scalp';
    } else if (lowerComment.includes('swing')) {
      strategyTag = 'swing';
    }
  }

  return {
    id: String(entry.id),
    userId,
    symbol: entry.symbol || '',
    side,
    entryPrice,
    stopPrice,
    exitPrice,
    quantity,
    openedAt: timeOpen,
    closedAt: timeClose,
    realizedPnlUsd,
    realizedRr,
    timeframe,
    sessionLabel,
    strategyTag,
  };
}

/**
 * Compute win rate as percentage (0-100).
 * Returns null if no valid trades.
 */
export function computeWinRate(trades: AnalyzableTrade[]): number | null {
  if (trades.length === 0) {
    return null;
  }

  const winners = trades.filter((t) => t.realizedPnlUsd > 0).length;
  return (winners / trades.length) * 100;
}

/**
 * Compute average risk-reward ratio.
 * Returns null if no valid trades with RR data.
 */
export function computeAvgRr(trades: AnalyzableTrade[]): number | null {
  const validRrTrades = trades.filter((t) => t.realizedRr != null && t.realizedRr > 0);
  if (validRrTrades.length === 0) {
    return null;
  }

  const sumRr = validRrTrades.reduce((sum, t) => sum + (t.realizedRr || 0), 0);
  return sumRr / validRrTrades.length;
}

/**
 * Compute average PnL per trade in USD.
 * Returns null if no trades.
 */
export function computeAvgPnlUsd(trades: AnalyzableTrade[]): number | null {
  if (trades.length === 0) {
    return null;
  }

  const sumPnl = trades.reduce((sum, t) => sum + t.realizedPnlUsd, 0);
  return sumPnl / trades.length;
}

/**
 * Compute median risk per trade as percentage of equity.
 * Returns null if insufficient data.
 */
export function computeMedianRiskPerTradePct(
  trades: AnalyzableTrade[],
  equitySeries?: number[]
): number | null {
  const riskPercentages: number[] = [];

  for (const trade of trades) {
    if (trade.stopPrice == null || trade.equityAtOpenUsd == null || trade.equityAtOpenUsd <= 0) {
      continue;
    }

    const riskUsd = Math.abs(trade.entryPrice - trade.stopPrice) * trade.quantity;
    const riskPct = (riskUsd / trade.equityAtOpenUsd) * 100;
    riskPercentages.push(riskPct);
  }

  if (riskPercentages.length === 0) {
    return null;
  }

  // Return median
  riskPercentages.sort((a, b) => a - b);
  const mid = Math.floor(riskPercentages.length / 2);
  if (riskPercentages.length % 2 === 0) {
    return (riskPercentages[mid - 1] + riskPercentages[mid]) / 2;
  }
  return riskPercentages[mid];
}

/**
 * Compute maximum drawdown percentage from equity curve.
 * Returns null if insufficient data (< 2 closed trades).
 */
export function computeMaxDrawdownPct(trades: AnalyzableTrade[]): number | null {
  const closedTrades = trades.filter((t) => t.closedAt != null && t.exitPrice != null);
  if (closedTrades.length < 2) {
    return null;
  }

  // Sort by closedAt ascending
  closedTrades.sort((a, b) => {
    const aTime = a.closedAt?.getTime() ?? 0;
    const bTime = b.closedAt?.getTime() ?? 0;
    return aTime - bTime;
  });

  // Compute cumulative PnL
  const pnls: number[] = [];
  for (const trade of closedTrades) {
    pnls.push(trade.realizedPnlUsd);
  }

  // Build equity curve and track peaks/troughs
  let cumulativePnL = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const pnl of pnls) {
    cumulativePnL += pnl;
    if (cumulativePnL > peak) {
      peak = cumulativePnL;
    }
    const drawdown = peak - cumulativePnL;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Use starting equity or peak as baseline
  const firstTrade = closedTrades[0];
  const startingEquity = firstTrade.equityAtOpenUsd ?? peak;

  if (peak <= 0 || startingEquity <= 0) {
    return null;
  }

  const baseline = Math.max(peak, startingEquity);
  if (baseline <= 0) {
    return null;
  }

  return (maxDrawdown / baseline) * 100;
}

/**
 * Bucket trades by a key selector and compute stats for each bucket.
 */
export function bucketTrades(
  trades: AnalyzableTrade[],
  keySelector: (t: AnalyzableTrade) => JournalStatsBucketKey
): JournalStatsBucket[] {
  const bucketsMap = new Map<string, AnalyzableTrade[]>();

  // Group trades by key
  for (const trade of trades) {
    const key = keySelector(trade);
    const keyStr = JSON.stringify(key);
    if (!bucketsMap.has(keyStr)) {
      bucketsMap.set(keyStr, []);
    }
    bucketsMap.get(keyStr)!.push(trade);
  }

  // Compute stats for each bucket
  const buckets: JournalStatsBucket[] = [];
  for (const [keyStr, bucketTrades] of bucketsMap.entries()) {
    const key = JSON.parse(keyStr) as JournalStatsBucketKey;
    buckets.push({
      key,
      tradeCount: bucketTrades.length,
      winRatePct: computeWinRate(bucketTrades),
      avgRr: computeAvgRr(bucketTrades),
      avgPnlUsd: computeAvgPnlUsd(bucketTrades),
      medianRiskPerTradePct: computeMedianRiskPerTradePct(bucketTrades),
      maxDrawdownPct: computeMaxDrawdownPct(bucketTrades),
    });
  }

  return buckets;
}

/**
 * Detect behavioral patterns in trading history using deterministic heuristics.
 */
export function detectBehaviourPatterns(
  trades: AnalyzableTrade[],
  profileMetrics: UserProfileMetrics | null
): BehaviourPattern[] {
  const patterns: BehaviourPattern[] = [];

  if (trades.length < 5) {
    return patterns; // Need minimum trades for pattern detection
  }

  // Sort trades by openedAt
  const sortedTrades = [...trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

  // Pattern 1: Overtrading
  // High trade frequency with deteriorating performance
  const tradesByDay = new Map<string, AnalyzableTrade[]>();
  for (const trade of sortedTrades) {
    const dayKey = trade.openedAt.toISOString().split('T')[0];
    if (!tradesByDay.has(dayKey)) {
      tradesByDay.set(dayKey, []);
    }
    tradesByDay.get(dayKey)!.push(trade);
  }

  let highFrequencyDays = 0;
  for (const dayTrades of tradesByDay.values()) {
    if (dayTrades.length >= PATTERN_THRESHOLDS.OVERTRADING_MIN_TRADES_PER_DAY) {
      highFrequencyDays++;
    }
  }

  if (highFrequencyDays > 0) {
    // Check if performance deteriorated on high-frequency days
    const highFreqTrades: AnalyzableTrade[] = [];
    const normalTrades: AnalyzableTrade[] = [];
    for (const [dayKey, dayTrades] of tradesByDay.entries()) {
      if (dayTrades.length >= PATTERN_THRESHOLDS.OVERTRADING_MIN_TRADES_PER_DAY) {
        highFreqTrades.push(...dayTrades);
      } else {
        normalTrades.push(...dayTrades);
      }
    }

    if (normalTrades.length > 0 && highFreqTrades.length > 0) {
      const highFreqWinRate = computeWinRate(highFreqTrades) || 0;
      const normalWinRate = computeWinRate(normalTrades) || 0;
      if (normalWinRate - highFreqWinRate > PATTERN_THRESHOLDS.OVERTRADING_WIN_RATE_DROP_PCT) {
        patterns.push({
          type: 'overtrading',
          description: `High trade frequency (${highFrequencyDays} days with 5+ trades) with ${(normalWinRate - highFreqWinRate).toFixed(1)}% lower win rate`,
          evidenceTrades: highFreqTrades.slice(0, 10).map((t) => t.id),
        });
      }
    }
  }

  // Pattern 2: Revenge Trading
  // Size increases immediately after losses
  for (let i = 1; i < sortedTrades.length; i++) {
    const prevTrade = sortedTrades[i - 1];
    const currentTrade = sortedTrades[i];
    const timeDiff = currentTrade.openedAt.getTime() - (prevTrade.closedAt?.getTime() || prevTrade.openedAt.getTime());
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    // Check if previous trade was a loss and current trade is within 24 hours
    if (prevTrade.realizedPnlUsd < 0 && hoursDiff < 24) {
      const prevSize = prevTrade.entryPrice * prevTrade.quantity;
      const currentSize = currentTrade.entryPrice * currentTrade.quantity;
      if (currentSize > prevSize * PATTERN_THRESHOLDS.REVENGE_TRADING_SIZE_INCREASE_FACTOR) {
        patterns.push({
          type: 'revenge_trading',
          description: `Position size increased by ${((currentSize / prevSize - 1) * 100).toFixed(0)}% within 24 hours after a loss`,
          evidenceTrades: [prevTrade.id, currentTrade.id],
        });
        break; // Only report first instance
      }
    }
  }

  // Pattern 3: Size Inconsistency
  // High variance in position sizes vs typical
  if (profileMetrics) {
    const positionSizes = sortedTrades.map((t) => t.entryPrice * t.quantity);
    const meanSize = positionSizes.reduce((sum, s) => sum + s, 0) / positionSizes.length;
    const variance =
      positionSizes.reduce((sum, s) => sum + Math.pow(s - meanSize, 2), 0) / positionSizes.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = meanSize > 0 ? stdDev / meanSize : 0;

    if (coefficientOfVariation > PATTERN_THRESHOLDS.SIZE_INCONSISTENCY_CV_THRESHOLD) {
      patterns.push({
        type: 'size_inconsistency',
        description: `High position size variance (CV: ${coefficientOfVariation.toFixed(2)}) vs typical size of $${profileMetrics.typicalPositionSizeUsd.toFixed(2)}`,
        evidenceTrades: sortedTrades.slice(0, 10).map((t) => t.id),
      });
    }
  }

  // Pattern 4: RR Mismanagement
  // Median realized RR significantly below profile average
  if (profileMetrics && profileMetrics.avgRrRatio != null) {
    const validRrTrades = sortedTrades.filter((t) => t.realizedRr != null && t.realizedRr > 0);
    if (validRrTrades.length > 0) {
      const rrValues = validRrTrades.map((t) => t.realizedRr!).sort((a, b) => a - b);
      const medianRr = rrValues[Math.floor(rrValues.length / 2)];
      const profileRr = profileMetrics.avgRrRatio;

      if (medianRr < profileRr * PATTERN_THRESHOLDS.RR_MISMANAGEMENT_FACTOR) {
        patterns.push({
          type: 'rr_mismanagement',
          description: `Median realized RR (${medianRr.toFixed(2)}) is ${((1 - medianRr / profileRr) * 100).toFixed(0)}% below profile average (${profileRr.toFixed(2)})`,
          evidenceTrades: validRrTrades.slice(0, 10).map((t) => t.id),
        });
      }
    }
  }

  // Pattern 5: Session Performance Variation
  // Strong win rate differences by session
  const bySession = bucketTrades(sortedTrades, (t) => ({ sessionLabel: t.sessionLabel || undefined }));
  if (bySession.length >= 2) {
    const sessionWinRates = bySession
      .filter((b) => b.winRatePct != null)
      .map((b) => ({ session: b.key.sessionLabel || 'Unknown', winRate: b.winRatePct! }));
    if (sessionWinRates.length >= 2) {
      const maxWinRate = Math.max(...sessionWinRates.map((s) => s.winRate));
      const minWinRate = Math.min(...sessionWinRates.map((s) => s.winRate));
      if (maxWinRate - minWinRate > PATTERN_THRESHOLDS.SESSION_VARIATION_WIN_RATE_DIFF_PCT) {
        const bestSession = sessionWinRates.find((s) => s.winRate === maxWinRate)!;
        const worstSession = sessionWinRates.find((s) => s.winRate === minWinRate)!;
        patterns.push({
          type: 'session_performance_variation',
          description: `Strong performance variation: ${bestSession.session} (${maxWinRate.toFixed(1)}% win rate) vs ${worstSession.session} (${minWinRate.toFixed(1)}% win rate)`,
          evidenceTrades: sortedTrades
            .filter((t) => t.sessionLabel === bestSession.session || t.sessionLabel === worstSession.session)
            .slice(0, 10)
            .map((t) => t.id),
        });
      }
    }
  }

  // Pattern 6: Symbol-Specific Edge
  // Consistent performance on specific symbols
  const bySymbol = bucketTrades(sortedTrades, (t) => ({ symbol: t.symbol }));
  const symbolStats = bySymbol
    .filter((b) => b.tradeCount >= PATTERN_THRESHOLDS.SYMBOL_EDGE_MIN_TRADES && b.winRatePct != null)
    .map((b) => ({ symbol: b.key.symbol || 'Unknown', winRate: b.winRatePct!, tradeCount: b.tradeCount }));

  if (symbolStats.length >= 2) {
    const overallWinRate = computeWinRate(sortedTrades) || 0;
    const bestSymbol = symbolStats.reduce((best, curr) => (curr.winRate > best.winRate ? curr : best));
    if (bestSymbol.winRate - overallWinRate > PATTERN_THRESHOLDS.SYMBOL_EDGE_WIN_RATE_ADVANTAGE_PCT) {
      patterns.push({
        type: 'symbol_specific_edge',
        description: `Strong performance on ${bestSymbol.symbol}: ${bestSymbol.winRate.toFixed(1)}% win rate (${bestSymbol.tradeCount} trades) vs overall ${overallWinRate.toFixed(1)}%`,
        evidenceTrades: sortedTrades
          .filter((t) => t.symbol === bestSymbol.symbol)
          .slice(0, 10)
          .map((t) => t.id),
      });
    }
  }

  return patterns;
}
