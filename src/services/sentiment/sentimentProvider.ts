/**
 * Sentiment Provider Abstraction
 *
 * Defines the interface for sentiment data providers that can fetch
 * raw sentiment signals for a given symbol and asset class.
 */

import { logger } from '../../config/logger';
import type { AssetClass } from '../../types/market';
import type { RawSentimentSignal } from './sentimentTypes';

/**
 * Arguments for fetching sentiment signals from a provider.
 */
export interface FetchSignalsArgs {
  symbol: string;
  assetClass: AssetClass;
  windowMinutes: number;
  /** When set, news providers should use this as the cutoff (from) date instead of (now - windowMinutes). Enables "news from start of week/month/year" for larger windows. */
  newsFromDate?: Date;
  /** Optional preferred timeframe for market context (e.g. "monthly", "weekly"). When window is month-long, passing "monthly" avoids stale_data for price snapshots. */
  timeframeHint?: string;
}

/**
 * Interface for sentiment data providers.
 *
 * Each provider implements this interface to provide sentiment signals
 * from a specific source (e.g., news APIs, social media, price action).
 */
export interface SentimentProvider {
  /**
   * Unique name identifier for this provider.
   * Used for logging, debugging, and data quality tracking.
   */
  name: string;

  /**
   * Check if this provider supports the given asset class.
   *
   * @param assetClass The asset class to check
   * @returns true if this provider can fetch signals for the asset class
   */
  supports(assetClass: AssetClass): boolean;

  /**
   * Fetch raw sentiment signals for the given symbol and asset class.
   *
   * @param args Arguments containing symbol, asset class, and time window
   * @returns Promise resolving to an array of raw sentiment signals
   *
   * Note: Providers should return an empty array ([]) if:
   * - No signals are available for the symbol
   * - An error occurs (log the error, don't throw)
   * - The provider is misconfigured (missing API keys, etc.)
   *
   * This allows graceful degradation - if one provider fails,
   * others can still contribute signals.
   */
  fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]>;
}

/**
 * Get the default list of sentiment providers.
 *
 * Returns all enabled providers in the system. The order matters
 * for some use cases, but generally providers are called in parallel.
 *
 * @returns Array of all default sentiment providers
 */
export function getDefaultSentimentProviders(): SentimentProvider[] {
  const providers: SentimentProvider[] = [];

  // Layer 1: Price action fallback (always available)
  try {
    const { PriceActionSentimentProvider } = require('./providers/priceActionSentimentProvider');
    providers.push(new PriceActionSentimentProvider());
  } catch (error) {
    // Provider not yet implemented or import failed, skip
    // This allows the system to work even if a provider has issues
  }

  // Layer 2: External sentiment feeds
  try {
    const {
      AlphaVantageNewsSentimentProvider,
    } = require('./providers/alphaVantageSentimentProvider');
    providers.push(new AlphaVantageNewsSentimentProvider());
  } catch (error) {
    // Provider not yet implemented or import failed, skip
  }

  try {
    const { CryptoFearGreedProvider } = require('./providers/cryptoFearGreedProvider');
    providers.push(new CryptoFearGreedProvider());
  } catch (error) {
    // Provider not yet implemented or import failed, skip
  }

  try {
    const {
      EconomicCalendarSentimentProvider,
    } = require('./providers/economicCalendarSentimentProvider');
    providers.push(new EconomicCalendarSentimentProvider());
  } catch (error) {
    // Provider not yet implemented or import failed, skip
  }

  // Finnhub: only if key set and flags enabled
  if (process.env.FINNHUB_API_KEY && process.env.SENTIMENT_ENABLE_FINNHUB_EQUITY === 'true') {
    try {
      const {
        FinnhubEquityNewsSentimentProvider,
      } = require('./providers/finnhubEquityNewsProvider');
      providers.push(new FinnhubEquityNewsSentimentProvider());
    } catch (error) {
      // Skip if import failed
    }
  }
  if (process.env.FINNHUB_API_KEY && process.env.SENTIMENT_ENABLE_FINNHUB_GENERAL === 'true') {
    logger.info('FinnhubGeneralNewsProvider enabled');
    try {
      const { FinnhubGeneralNewsProvider } = require('./providers/finnhubGeneralNewsProvider');
      providers.push(new FinnhubGeneralNewsProvider());
    } catch (error) {
      // Skip if import failed
      logger.error('FinnhubGeneralNewsProvider import failed', { error: error });
    }
  }

  return providers;
}

/**
 * Get providers that support a specific asset class.
 *
 * @param providers Array of providers to filter
 * @param assetClass Asset class to filter by
 * @returns Array of providers that support the asset class
 */
export function getProvidersForAssetClass(
  providers: SentimentProvider[],
  assetClass: AssetClass
): SentimentProvider[] {
  return providers.filter((provider) => provider.supports(assetClass));
}
