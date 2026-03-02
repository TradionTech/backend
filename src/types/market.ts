/**
 * Market Context Type Definitions
 * 
 * Core types for the Market Context Awareness layer that provides structured
 * market data to the chat orchestrator.
 */

/**
 * Asset class classification for financial instruments
 */
export type AssetClass = 'FX' | 'EQUITY' | 'CRYPTO' | 'FUTURES' | 'INDEX' | 'OTHER';

/**
 * Timeframe unit for market data
 * M = minutes, H = hours, D = days, W = weeks, Mo = months (avoids clash with M)
 */
export type TimeframeUnit = 'M' | 'H' | 'D' | 'W' | 'Mo';

/**
 * Canonical timeframe representation
 */
export interface Timeframe {
  unit: TimeframeUnit;
  size: number;
  label: string; // Human-friendly label (e.g., "1 Hour", "Daily")
}

/**
 * Request for market context
 */
export interface MarketContextRequest {
  userId?: string;
  symbol?: string;
  assetClass?: AssetClass;
  timeframeHint?: string; // Plain text from user (e.g., "intraday", "1H", "swing")
  rawQuery?: string; // Original user message for fallback parsing
}

/**
 * Raw market data from provider (before processing)
 */
export interface RawMarketData {
  symbol: string;
  assetClass: AssetClass;
  candles?: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
  lastPrice?: number;
  timestamp?: number;
  provider?: string;
  exchange?: string;
  base?: string; // For FX pairs
  quote?: string; // For FX pairs
  issues?: string[]; // Provider-specific issues (e.g., "intraday_unavailable_for_free_tier")
}

/**
 * Price snapshot at a point in time
 */
export interface PriceSnapshot {
  last: number;
  changePct?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
  timestamp: number;
}

/**
 * Trend classification
 */
export type TrendDirection = 'up' | 'down' | 'sideways';
export type TrendBasis = 'short_term' | 'medium_term' | 'long_term';

/**
 * Trend signals derived from price data
 */
export interface TrendSignals {
  trend: TrendDirection;
  basis: TrendBasis;
}

/**
 * Volatility level classification
 */
export type VolatilityLevel = 'low' | 'medium' | 'high';

/**
 * Volatility signals derived from price data
 */
export interface VolatilitySignals {
  volatilityLevel: VolatilityLevel;
  metric?: string; // e.g., "std_dev", "atr"
  value?: number; // Numeric value of the metric
}

/**
 * Data quality indicators
 */
export interface DataQuality {
  isFresh: boolean;
  ageSeconds?: number;
  source: string;
  issues?: string[]; // e.g., ["stale_data", "missing_candles"]
}

/**
 * Instrument information
 */
export interface Instrument {
  symbol: string;
  assetClass: AssetClass;
  exchange?: string;
  base?: string; // For FX pairs
  quote?: string; // For FX pairs
}

/**
 * Complete market context structure
 */
export interface MarketContext {
  instrument: Instrument;
  timeframe?: Timeframe;
  priceSnapshot?: PriceSnapshot;
  trendSignals?: TrendSignals;
  volatilitySignals?: VolatilitySignals;
  dataQuality: DataQuality;
}

/**
 * Result from market context service
 */
export interface MarketContextResult {
  contextAvailable: boolean;
  context?: MarketContext;
  reason?: string; // e.g., "NO_PROVIDER", "PROVIDER_ERROR", "NO_SYMBOL"
  error?: string;
}
