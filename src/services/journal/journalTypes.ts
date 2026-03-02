import type {
  AnalyzableTrade as BaseAnalyzableTrade,
  UserProfileMetrics,
} from '../profile/profileTypes.js';

/**
 * Coaching intent types that determine the focus and analysis window for journal coaching.
 */
export type CoachingIntent =
  | 'overview'
  | 'recent_performance'
  | 'pattern_detection'
  | 'risk_discipline'
  | 'emotional_control';

/**
 * Extended AnalyzableTrade with journal-specific computed fields.
 * Extends the base AnalyzableTrade from profileTypes with additional fields
 * computed deterministically for journal analysis.
 */
export interface AnalyzableTrade extends BaseAnalyzableTrade {
  /** Realized PnL in USD (computed from entry/exit prices and quantity) */
  realizedPnlUsd: number;
  /** Realized risk-reward ratio (computed from stop/exit prices) */
  realizedRr?: number | null;
  /** Inferred timeframe category based on trade duration */
  timeframe?: string | null; // "scalp" | "intraday" | "swing" | "position"
  /** Inferred trading session label based on entry time */
  sessionLabel?: string | null; // "London" | "NY" | "Asia" | "Overlap"
  /** Strategy tag extracted from JournalEntry notes or TradeHistory comment */
  strategyTag?: string | null;
}

/**
 * Key for grouping trades into statistical buckets.
 * Used to aggregate stats by symbol, timeframe, session, or strategy.
 */
export interface JournalStatsBucketKey {
  symbol?: string;
  timeframe?: string;
  sessionLabel?: string;
  strategyTag?: string;
}

/**
 * Statistical bucket containing aggregated metrics for a group of trades.
 */
export interface JournalStatsBucket {
  key: JournalStatsBucketKey;
  /** Number of trades in this bucket */
  tradeCount: number;
  /** Win rate as percentage (0-100) */
  winRatePct: number | null;
  /** Average risk-reward ratio */
  avgRr: number | null;
  /** Average PnL per trade in USD */
  avgPnlUsd: number | null;
  /** Median risk per trade as percentage of equity */
  medianRiskPerTradePct: number | null;
  /** Maximum drawdown percentage within this bucket */
  maxDrawdownPct: number | null;
  /** Optional deterministic comment about this bucket */
  comment?: string;
}

/**
 * Detected behavioral pattern in trading history.
 * Patterns are detected using deterministic heuristics.
 */
export interface BehaviourPattern {
  type:
    | 'overtrading'
    | 'revenge_trading'
    | 'size_inconsistency'
    | 'rr_mismanagement'
    | 'session_performance_variation'
    | 'symbol_specific_edge'
    | 'other';
  /** Human-readable description of the pattern */
  description: string;
  /** Trade IDs that provide evidence for this pattern */
  evidenceTrades: string[];
}

/**
 * Complete journal context structure passed to LLM for coaching.
 * Contains all deterministic stats, patterns, and metadata.
 */
export interface JournalContextForLLM {
  userId: string;
  /** Analysis window information */
  window: {
    from: Date;
    to: Date;
    tradeCount: number;
  };
  /** Overall statistics across all trades in window */
  overallStats: JournalStatsBucket;
  /** Statistics grouped by trading symbol */
  bySymbol: JournalStatsBucket[];
  /** Statistics grouped by trading session */
  bySession: JournalStatsBucket[];
  /** Statistics grouped by timeframe */
  byTimeframe: JournalStatsBucket[];
  /** Statistics grouped by strategy tag */
  byStrategy: JournalStatsBucket[];
  /** Detected behavioral patterns */
  behaviourPatterns: BehaviourPattern[];
  /** User profile metrics (if available) */
  profileMetrics: UserProfileMetrics | null;
  /** Summary of journal entry notes */
  notesSummary?: {
    totalEntries: number;
    commonThemes: string[];
  };
  /** Data quality assessment */
  dataQuality: {
    enoughTrades: boolean;
    tradesConsidered: number;
    missingFields: string[];
  };
}

/**
 * Request parameters for building journal context.
 */
export interface JournalAnalysisRequest {
  userId: string;
  /** Start date for analysis window (optional, defaults to last 60 days) */
  from?: Date;
  /** End date for analysis window (optional, defaults to now) */
  to?: Date;
  /** Maximum number of trades to analyze (default: 300-500) */
  maxTrades?: number;
  /** Coaching intent to determine focus (optional) */
  coachingIntent?: CoachingIntent;
}
