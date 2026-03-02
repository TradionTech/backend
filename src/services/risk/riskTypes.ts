export type RiskProfile = "conservative" | "moderate" | "aggressive";
export type ExperienceLevel = "novice" | "intermediate" | "advanced";
export type Timeframe = "scalp" | "intraday" | "swing" | "position";
export type OrderType = "market" | "limit";
export type TradeSide = "long" | "short";

export interface UserContext {
  userId: string;
  riskProfile: RiskProfile;
  experienceLevel: ExperienceLevel;
  typicalRiskPerTradePct: number;      // e.g. 0.5 for 0.5%
  typicalPositionSizeUsd: number;      // e.g. 1500
}

export interface AccountState {
  accountId: string;
  equityUsd: number;
  availableMarginUsd: number;
  openRiskUsd: number;
  openPositions: Array<{ symbol: string; riskUsd: number }>;
}

export interface TradeIntent {
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number | null;
  quantity: number;
  leverage?: number | null;  // default 1 internally if missing
  timeframe: Timeframe;
  orderType: OrderType;
}

export interface MarketSnapshot {
  symbol: string;
  currentPrice: number;
  atr?: number | null;
  tickSize?: number | null;
  minNotional?: number | null;
  maxLeverageAllowed?: number | null;
  sessionVolatilityPct?: number | null;
}

export interface RiskEvaluationRequest {
  userContext: UserContext;
  accountState: AccountState;
  tradeIntent: TradeIntent;
  marketSnapshot: MarketSnapshot;
}

export interface RiskMetrics {
  riskPerTradeUsd: number;
  riskPerTradePct: number;
  rewardUsd: number | null;
  rrRatio: number | null;
  totalRiskUsd: number;
  totalRiskPct: number;
  effectiveLeverage: number;
  riskVsTypicalFactor: number;
  sizeVsTypicalFactor: number;
}

export type PolicyFlagCode =
  | "RISK_PER_TRADE_TOO_HIGH"
  | "TOTAL_RISK_TOO_HIGH"
  | "LEVERAGE_TOO_HIGH"
  | "RR_TOO_LOW"
  | "ABOVE_TYPICAL_RISK"
  | "ABOVE_TYPICAL_SIZE";

export type PolicyFlagSeverity = "info" | "warning" | "high";

export interface PolicyFlag {
  code: PolicyFlagCode;
  severity: PolicyFlagSeverity;
  message: string;
}

export interface RiskEvaluationResult {
  riskMetrics: RiskMetrics;
  policyFlags: PolicyFlag[];
  engineVersion: string;
}
