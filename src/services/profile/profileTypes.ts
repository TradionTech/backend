export interface UserProfileMetrics {
  userId: string;
  typicalRiskPerTradePct: number;
  typicalPositionSizeUsd: number;
  avgRrRatio: number | null;
  maxDrawdownPct: number | null;
  lastComputedAt: Date;
}

export interface UserProfileRecomputeOptions {
  userId: string;
  maxTrades?: number; // default e.g. 500
}

export interface AnalyzableTrade {
  id: string;
  userId: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice?: number | null;
  exitPrice?: number | null;
  quantity: number;
  openedAt: Date;
  closedAt?: Date | null;
  equityAtOpenUsd?: number | null; // optional, may be null
}
