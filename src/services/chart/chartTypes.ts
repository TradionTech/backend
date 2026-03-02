/**
 * Chart Analysis Type Definitions
 *
 * Core types for the Chart Analysis Intelligence layer that provides structured
 * chart vision features and context to the chat orchestrator.
 */

/**
 * Source of the chart image
 */
export type ChartSource = 'upload' | 'generated' | 'external_link';

/**
 * Request for chart analysis
 */
export interface ChartAnalysisRequest {
  source: ChartSource;
  chartId?: string; // UUID of ChartUpload record (required if source is 'upload')
  symbolHint?: string; // Optional symbol hint
  timeframeHint?: string; // Optional timeframe hint
  userId?: string; // User ID for access control and market context
  rawQuery?: string; // Original user message for context
}

/**
 * Chart pattern codes detected by vision analysis
 */
export type ChartPatternCode =
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'RANGE'
  | 'HEAD_AND_SHOULDERS'
  | 'DOUBLE_TOP'
  | 'DOUBLE_BOTTOM'
  | 'TRIANGLE'
  | 'FLAG'
  | 'CHANNEL'
  | 'SUPPORT_RESISTANCE_CLUSTER'
  | 'UNKNOWN_PATTERN';

/**
 * Detected chart pattern with confidence and optional region
 */
export interface DetectedPattern {
  code: ChartPatternCode;
  confidence: number; // 0-1
  description: string;
  region?: {
    fromTs: string; // ISO timestamp
    toTs: string; // ISO timestamp
  } | null;
}

/**
 * Detected support or resistance level
 */
export interface DetectedLevel {
  type: 'support' | 'resistance';
  price: number;
  confidence: number; // 0-1
  label?: string; // Optional label (e.g., "Strong Support", "Previous High")
}

/**
 * Indicator summary detected on chart
 */
export interface IndicatorSummary {
  name: 'MA' | 'RSI' | 'MACD' | 'BBANDS' | 'OTHER';
  parameters?: Record<string, number | string>; // e.g., { period: 20, type: 'SMA' }
  observation: string; // What the indicator shows
}

/**
 * Metadata extracted from chart (symbol, timeframe, provider hints)
 */
export interface ChartMetadata {
  symbol?: string; // e.g., "EURUSD", "BTC", "AAPL"
  timeframeLabel?: string; // e.g., "1H", "4H", "Daily", "Weekly"
  providerHint?: string; // e.g., "TradingView", "MT4", "MT5"
}

/**
 * Complete vision features extracted from chart image
 */
export interface ChartVisionFeatures {
  metadata: ChartMetadata;
  primaryTrend?: 'up' | 'down' | 'sideways' | 'unclear';
  patterns: DetectedPattern[];
  keyLevels: DetectedLevel[];
  indicators: IndicatorSummary[];
  notableEvents: string[]; // e.g., ["Breakout above resistance", "Volume spike"]
  notes: string[]; // General observations
}

/**
 * Market context summary (enriched from MarketContextService)
 */
export interface ChartMarketContextSummary {
  trendSignals?: {
    trend: string; // "up" | "down" | "sideways"
    basis: string; // "short_term" | "medium_term" | "long_term"
  };
  volatilitySignals?: {
    volatilityLevel: string; // "low" | "medium" | "high"
    metric?: string; // e.g., "std_dev", "atr"
    value?: number; // Numeric value
  };
  dataQuality: {
    isFresh: boolean;
    ageSeconds?: number;
    source: string;
    issues?: string[]; // e.g., ["stale_data", "missing_candles"]
  };
}

/**
 * Uncertainty tracking for chart analysis
 */
export interface ChartUncertainty {
  fromVision: string[]; // e.g., ["no_symbol_for_market_context", "low_confidence_patterns"]
  fromMarketData: string[]; // e.g., ["market_data_stale", "no_symbol_for_market_context"]
}

/**
 * Complete chart context passed to LLM
 */
export interface ChartContextForLLM {
  source: ChartSource;
  chartId?: string; // UUID of ChartUpload record
  symbol?: string; // Resolved symbol (from vision or hints)
  timeframeLabel?: string; // Resolved timeframe (from vision or hints)
  visionFeatures: ChartVisionFeatures;
  marketContextSummary?: ChartMarketContextSummary;
  uncertainty: ChartUncertainty;
}
