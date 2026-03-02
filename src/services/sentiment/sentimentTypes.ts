/**
 * Sentiment Snapshot Intelligence - Domain Types
 * 
 * Core types for sentiment aggregation, normalization, and LLM context.
 * All scoring and aggregation is deterministic and computed in the backend.
 */

export type SentimentDirection = "bullish" | "bearish" | "neutral" | "mixed";

/**
 * Raw sentiment signal from a provider/source.
 * Contains the original score on the provider's native scale.
 */
export interface RawSentimentSignal {
  id: string;
  symbol: string;
  source: string;        // e.g. "news_api", "twitter", "research", "aggregated"
  providerId?: string;   // provider-specific id
  score: number;         // raw score (provider native scale)
  scaleMin: number;      // min of provider scale
  scaleMax: number;      // max of provider scale
  weight: number;        // default weight for aggregation
  timestamp: Date;
  label?: string | null; // short label, e.g. "earnings", "downgrade", "macro"
  /** Optional dimension for debugging / future weighting, e.g. "1h_momentum", "fg_level" */
  dimension?: string;
  /** Optional details for debugging; not used by aggregator */
  details?: Record<string, unknown>;
}

/**
 * Normalized sentiment signal on -1..1 scale.
 * All signals are normalized before aggregation.
 */
export interface NormalizedSentimentSignal {
  symbol: string;
  source: string;
  normalizedScore: number; // normalized to -1..1
  weight: number;
  timestamp: Date;
  label?: string | null;
}

/**
 * Configuration for sentiment snapshot computation.
 */
export interface SentimentSnapshotConfig {
  windowMinutes: number;          // e.g. 240 (last 4h)
  minSignals: number;             // e.g. 5
  neutralThreshold: number;       // e.g. 0.15 on -1..1
  strongThreshold: number;        // e.g. 0.5
}

/**
 * Aggregated sentiment score with direction and confidence.
 * Computed deterministically from normalized signals.
 */
export interface SentimentScoreAggregate {
  symbol: string;
  score: number;                  // aggregated -1..1
  direction: SentimentDirection;
  confidence: number;             // 0..1 based on signal count, diversity, recency
  signalsUsed: number;
  sourcesUsed: string[];
}

/**
 * Top driver/theme contributing to sentiment.
 * Derived from signal labels and weights.
 */
export interface SentimentDriver {
  /** Internal key (used by backend/tests), not shown to users. e.g. "price_momentum", "fear_greed_index" */
  id: string;
  /** User-facing label for prompts/responses. e.g. "recent price action", "Crypto Fear & Greed index" */
  label: string;
  explanation: string;            // deterministic text, optional or short
  weight: number;                 // contribution (kept internal)
}

/**
 * Data quality indicators for the sentiment snapshot.
 */
export interface SentimentDataQuality {
  hasEnoughSignals: boolean;
  signalsAvailable: number;
  sourcesAvailable: string[];
  windowMinutes: number;
  isFresh: boolean;
  issues: string[];               // e.g. ["LOW_SIGNAL_COUNT", "NO_RECENT_DATA"]
}

/**
 * Complete sentiment context for LLM consumption.
 * This is the single source of truth for sentiment information.
 */
export interface SentimentContextForLLM {
  symbol: string;
  baseAssetClass?: string;        // from market types, optional
  windowDescription: string;      // e.g., "last 4 hours", "last 24 hours"
  aggregate: SentimentScoreAggregate | null;
  drivers: SentimentDriver[];
  rawStats: {
    bySource: Array<{
      source: string;
      avgScore: number;          // -1..1
      signals: number;
    }>;
    latestTimestamp?: Date | null;
  };
  dataQuality: SentimentDataQuality;
}

/**
 * Request for building a sentiment snapshot.
 */
export interface SentimentSnapshotRequest {
  symbol: string;
  windowMinutes?: number;
  userId?: string;
  timeframeHint?: string;
}
