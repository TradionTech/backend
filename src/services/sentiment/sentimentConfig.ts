/**
 * Sentiment Snapshot Configuration
 * 
 * Default configuration for sentiment snapshot computation.
 * Can be overridden by environment variables or per-request parameters.
 */

import type { SentimentSnapshotConfig } from './sentimentTypes';
import { env } from '../../config/env';

/**
 * Default sentiment snapshot configuration.
 */
export const defaultSentimentConfig: SentimentSnapshotConfig = {
  windowMinutes: 240,        // Last 4 hours for intraday snapshot
  minSignals: 5,             // Minimum signals required for reliable aggregate
  neutralThreshold: 0.15,    // Threshold on -1..1 scale for neutral classification
  strongThreshold: 0.5,      // Threshold for strong sentiment (bullish/bearish)
};

/**
 * Get sentiment config with optional env overrides.
 * 
 * Environment variables (optional):
 * - SENTIMENT_WINDOW_MINUTES: Override windowMinutes
 * - SENTIMENT_MIN_SIGNALS: Override minSignals
 * - SENTIMENT_NEUTRAL_THRESHOLD: Override neutralThreshold
 * - SENTIMENT_STRONG_THRESHOLD: Override strongThreshold
 */
export function getSentimentConfig(): SentimentSnapshotConfig {
  const config = { ...defaultSentimentConfig };

  // Allow env overrides
  if (env.SENTIMENT_WINDOW_MINUTES) {
    const windowMinutes = parseInt(env.SENTIMENT_WINDOW_MINUTES, 10);
    if (!isNaN(windowMinutes) && windowMinutes > 0) {
      config.windowMinutes = windowMinutes;
    }
  }

  if (env.SENTIMENT_MIN_SIGNALS) {
    const minSignals = parseInt(env.SENTIMENT_MIN_SIGNALS, 10);
    if (!isNaN(minSignals) && minSignals > 0) {
      config.minSignals = minSignals;
    }
  }

  if (env.SENTIMENT_NEUTRAL_THRESHOLD) {
    const neutralThreshold = parseFloat(env.SENTIMENT_NEUTRAL_THRESHOLD);
    if (!isNaN(neutralThreshold) && neutralThreshold >= 0 && neutralThreshold <= 1) {
      config.neutralThreshold = neutralThreshold;
    }
  }

  if (env.SENTIMENT_STRONG_THRESHOLD) {
    const strongThreshold = parseFloat(env.SENTIMENT_STRONG_THRESHOLD);
    if (!isNaN(strongThreshold) && strongThreshold >= 0 && strongThreshold <= 1) {
      config.strongThreshold = strongThreshold;
    }
  }

  return config;
}
