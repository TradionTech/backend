import { Op } from 'sequelize';
import { TradeHistory } from '../../db/models/TradeHistory.js';
import { MetaApiAccount } from '../../db/models/MetaApiAccount.js';
import { AccountEquitySnapshot } from '../../db/models/AccountEquitySnapshot.js';
import { UserProfileMetrics } from '../../db/models/UserProfileMetrics.js';
import { computeUserProfileMetricsFromTrades } from './profileAnalytics.js';
import type {
  AnalyzableTrade,
  UserProfileMetrics as UserProfileMetricsType,
  UserProfileRecomputeOptions,
} from './profileTypes.js';

/**
 * Reconstruct complete trades from TradeHistory deals.
 * Handles both complete trades (with timeOpen and timeClose) and grouped deals by positionId.
 */
function reconstructTradesFromHistory(
  historyRecords: TradeHistory[],
  userId: string
): Array<{ entry: TradeHistory; exit?: TradeHistory }> {
  const trades: Array<{ entry: TradeHistory; exit?: TradeHistory }> = [];
  const tradesByPosition = new Map<string, { entry?: TradeHistory; exit?: TradeHistory }>();

  for (const record of historyRecords) {
    // If record has both timeOpen and timeClose, treat as complete trade
    if (record.timeOpen != null && record.timeClose != null) {
      trades.push({ entry: record, exit: record });
      continue;
    }

    // Otherwise, group by positionId
    const positionId = record.positionId;
    if (!positionId) {
      // Skip records without positionId and without both timeOpen/timeClose
      continue;
    }

    if (!tradesByPosition.has(positionId)) {
      tradesByPosition.set(positionId, {});
    }

    const trade = tradesByPosition.get(positionId)!;

    // Check if this is an entry or exit deal
    if (
      record.entryType === 'DEAL_ENTRY_IN' ||
      (record.entryType == null && record.timeOpen != null)
    ) {
      if (
        !trade.entry ||
        (record.timeOpen && trade.entry.timeOpen && record.timeOpen < trade.entry.timeOpen)
      ) {
        trade.entry = record;
      }
    } else if (
      record.entryType === 'DEAL_ENTRY_OUT' ||
      (record.entryType == null && record.timeClose != null)
    ) {
      if (
        !trade.exit ||
        (record.timeClose && trade.exit.timeClose && record.timeClose > trade.exit.timeClose)
      ) {
        trade.exit = record;
      }
    }
  }

  // Add grouped trades that have both entry and exit
  for (const { entry, exit } of tradesByPosition.values()) {
    if (entry && exit) {
      trades.push({ entry, exit });
    }
  }

  return trades;
}

/**
 * Map TradeHistory records to AnalyzableTrade.
 * Handles both complete trades (entry === exit) and separate entry/exit deals.
 */
async function mapToAnalyzableTrade(
  entry: TradeHistory,
  exit: TradeHistory | undefined,
  userId: string
): Promise<AnalyzableTrade | null> {
  // If exit is not provided, use entry as both (complete trade)
  const exitRecord = exit || entry;

  // Need timeOpen and timeClose for a complete trade
  const timeOpen = entry.timeOpen;
  const timeClose = exitRecord.timeClose || entry.timeClose;

  if (!timeOpen || !timeClose) {
    return null;
  }

  // Determine side from dealType or type
  const dealType = entry.dealType || entry.type || '';
  const side: 'long' | 'short' =
    dealType.includes('BUY') || dealType.toLowerCase() === 'buy' ? 'long' : 'short';

  // Get equity at open time
  let equityAtOpenUsd: number | null = null;
  if (timeOpen) {
    const snapshot = await AccountEquitySnapshot.findOne({
      where: {
        accountId: entry.accountId,
        takenAt: { [Op.lte]: timeOpen },
      },
      order: [['takenAt', 'DESC']],
    });
    if (snapshot && snapshot.equity != null) {
      equityAtOpenUsd = Number(snapshot.equity);
    }
  }

  // For entry price, prefer entry deal price; for exit, prefer exit deal price
  // If it's a complete trade (entry === exit), we may need to look at profit to infer exit price
  let entryPrice = entry.price != null ? Number(entry.price) : 0;
  let exitPrice = exitRecord.price != null ? Number(exitRecord.price) : 0;

  // If exit price is missing but we have profit, try to infer it
  // profit = (exitPrice - entryPrice) * quantity for long, (entryPrice - exitPrice) * quantity for short
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

  if (entryPrice <= 0 || exitPrice <= 0 || quantity <= 0) {
    return null;
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
    equityAtOpenUsd,
  };
}

/**
 * Recompute user profile metrics from historical trades.
 */
export async function recomputeUserProfileMetrics(
  options: UserProfileRecomputeOptions
): Promise<UserProfileMetricsType> {
  const { userId, maxTrades = 500 } = options;

  // Get all MetaApi accounts for this user
  const accounts = await MetaApiAccount.findAll({
    where: { userId },
    attributes: ['id'],
  });

  if (accounts.length === 0) {
    // No accounts, return default metrics
    const defaultMetrics = {
      userId,
      typicalRiskPerTradePct: 0.5,
      typicalPositionSizeUsd: 0,
      avgRrRatio: null,
      maxDrawdownPct: null,
      lastComputedAt: new Date(),
    };
    await UserProfileMetrics.upsert(defaultMetrics);
    return defaultMetrics;
  }

  const accountIds = accounts.map((acc) => acc.id);

  // Query closed trades (those with timeClose set, or exit deals)
  // Order by timeClose DESC to get most recent first
  const historyRecords = await TradeHistory.findAll({
    where: {
      accountId: { [Op.in]: accountIds },
      [Op.or]: [{ timeClose: { [Op.ne]: null } }, { entryType: 'DEAL_ENTRY_OUT' }],
    },
    order: [
      ['timeClose', 'DESC NULLS LAST'],
      ['time', 'DESC'],
    ],
    limit: maxTrades * 2, // Get more records to account for grouping
  });

  // Reconstruct complete trades
  const reconstructedTrades = reconstructTradesFromHistory(historyRecords, userId);

  // Map to AnalyzableTrade and get equity snapshots
  const analyzableTrades: AnalyzableTrade[] = [];
  let processedCount = 0;

  for (const { entry, exit } of reconstructedTrades) {
    if (processedCount >= maxTrades) {
      break;
    }

    const analyzableTrade = await mapToAnalyzableTrade(entry, exit, userId);
    if (analyzableTrade) {
      analyzableTrades.push(analyzableTrade);
      processedCount++;
    }
  }

  // Compute metrics
  const computedMetrics = computeUserProfileMetricsFromTrades(analyzableTrades);

  // Upsert to database
  const metrics: UserProfileMetricsType = {
    userId,
    ...computedMetrics,
    lastComputedAt: new Date(),
  };

  // Upsert expects a plain object matching model attributes
  await UserProfileMetrics.upsert({
    userId: metrics.userId,
    typicalRiskPerTradePct: metrics.typicalRiskPerTradePct,
    typicalPositionSizeUsd: metrics.typicalPositionSizeUsd,
    avgRrRatio: metrics.avgRrRatio,
    maxDrawdownPct: metrics.maxDrawdownPct,
    lastComputedAt: metrics.lastComputedAt,
  });

  return metrics;
}

/**
 * Get user profile metrics from database.
 */
export async function getUserProfileMetrics(
  userId: string
): Promise<UserProfileMetricsType | null> {
  const record = await UserProfileMetrics.findOne({
    where: { userId },
  });

  if (!record) {
    return null;
  }

  // Convert Sequelize instance to plain object
  return {
    userId: record.userId,
    typicalRiskPerTradePct: Number(record.typicalRiskPerTradePct),
    typicalPositionSizeUsd: Number(record.typicalPositionSizeUsd),
    avgRrRatio: record.avgRrRatio != null ? Number(record.avgRrRatio) : null,
    maxDrawdownPct: record.maxDrawdownPct != null ? Number(record.maxDrawdownPct) : null,
    lastComputedAt: record.lastComputedAt,
  };
}
