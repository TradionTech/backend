import type { AnalyzableTrade, UserProfileMetrics } from './profileTypes.js';

/**
 * Compute the typical risk per trade as a percentage of account equity.
 * Uses median to reduce impact of outliers.
 */
export function computeTypicalRiskPerTradePct(trades: AnalyzableTrade[]): number {
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
    return 0.5; // Safe default
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
 * Compute typical position size in USD.
 * Uses median to reduce impact of outliers.
 */
export function computeTypicalPositionSizeUsd(trades: AnalyzableTrade[]): number {
  const positionSizes: number[] = [];

  for (const trade of trades) {
    const positionSizeUsd = trade.entryPrice * trade.quantity;
    positionSizes.push(positionSizeUsd);
  }

  if (positionSizes.length === 0) {
    return 0;
  }

  // Return median
  positionSizes.sort((a, b) => a - b);
  const mid = Math.floor(positionSizes.length / 2);
  if (positionSizes.length % 2 === 0) {
    return (positionSizes[mid - 1] + positionSizes[mid]) / 2;
  }
  return positionSizes[mid];
}

/**
 * Compute average risk-reward ratio.
 * Returns null if no valid trades with both stop and exit prices.
 */
export function computeAvgRrRatio(trades: AnalyzableTrade[]): number | null {
  const rrRatios: number[] = [];

  for (const trade of trades) {
    if (trade.stopPrice == null || trade.exitPrice == null) {
      continue;
    }

    const riskUsd = Math.abs(trade.entryPrice - trade.stopPrice) * trade.quantity;
    if (riskUsd <= 0) {
      continue; // Guard against zero risk
    }

    const rewardUsd = Math.abs(trade.exitPrice - trade.entryPrice) * trade.quantity;
    const rr = rewardUsd / riskUsd;
    rrRatios.push(rr);
  }

  if (rrRatios.length === 0) {
    return null;
  }

  // Return average
  const sum = rrRatios.reduce((acc, val) => acc + val, 0);
  return sum / rrRatios.length;
}

/**
 * Compute maximum drawdown percentage from equity curve.
 * Returns null if insufficient data (< 2 closed trades).
 */
export function computeMaxDrawdownPct(trades: AnalyzableTrade[]): number | null {
  // Filter to closed trades only
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
  // For long: profit = (exitPrice - entryPrice) * quantity
  // For short: profit = (entryPrice - exitPrice) * quantity
  const pnls: number[] = [];
  for (const trade of closedTrades) {
    let pnl: number;
    if (trade.side === 'long') {
      pnl = (trade.exitPrice! - trade.entryPrice) * trade.quantity;
    } else {
      pnl = (trade.entryPrice - trade.exitPrice!) * trade.quantity;
    }
    pnls.push(pnl);
  }

  // Build equity curve (assuming starting equity from first trade's equityAtOpenUsd, or use cumulative)
  // For simplicity, we'll use cumulative PnL and track peaks/troughs
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

  // If we have starting equity, use it; otherwise use peak as baseline
  const firstTrade = closedTrades[0];
  const startingEquity = firstTrade.equityAtOpenUsd ?? peak;

  // Calculate drawdown percentage
  if (peak <= 0 || startingEquity <= 0) {
    return null;
  }

  // Use the higher of peak or starting equity as the baseline
  const baseline = Math.max(peak, startingEquity);
  if (baseline <= 0) {
    return null;
  }

  return (maxDrawdown / baseline) * 100;
}

/**
 * Compute all user profile metrics from trades.
 * Returns metrics without userId and lastComputedAt (to be added by caller).
 */
export function computeUserProfileMetricsFromTrades(
  trades: AnalyzableTrade[]
): Omit<UserProfileMetrics, 'userId' | 'lastComputedAt'> {
  return {
    typicalRiskPerTradePct: computeTypicalRiskPerTradePct(trades),
    typicalPositionSizeUsd: computeTypicalPositionSizeUsd(trades),
    avgRrRatio: computeAvgRrRatio(trades),
    maxDrawdownPct: computeMaxDrawdownPct(trades),
  };
}
