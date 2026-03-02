/**
 * Sentiment Service
 *
 * Main service for building sentiment snapshots and context for LLM consumption.
 * Orchestrates data fetching, normalization, aggregation, and context building.
 */

import { Op } from 'sequelize';
import { SentimentScore } from '../../db/models/SentimentScore';
import { marketContextService } from '../market/marketContextService';
import { inferAssetClass, isBareCurrencyCode, toCanonicalFxSymbol } from '../market/assetClassInferrer';
import type { MarketContextRequest, AssetClass } from '../../types/market';
import type {
  RawSentimentSignal,
  NormalizedSentimentSignal,
  SentimentSnapshotRequest,
  SentimentContextForLLM,
  SentimentSnapshotConfig,
} from './sentimentTypes';
import { getSentimentConfig } from './sentimentConfig';
import {
  normalizeSignal,
  aggregateSignals,
  computeBySourceStats,
  deriveDrivers,
} from './sentimentMath';
import {
  getDefaultSentimentProviders,
  getProvidersForAssetClass,
  type SentimentProvider,
} from './sentimentProvider';
import { logger } from '../../config/logger';

const MIN_SIGNALS_DEFAULT = 5;
const MIN_SIGNALS_BY_ASSET: Partial<Record<AssetClass, number>> = {
  CRYPTO: 5,
  FX: 5,
  EQUITY: 5,
  INDEX: 3,
  FUTURES: 3,
  OTHER: 3,
};

function getMinSignals(assetClass: AssetClass | undefined): number {
  if (!assetClass) return MIN_SIGNALS_DEFAULT;
  return MIN_SIGNALS_BY_ASSET[assetClass] ?? MIN_SIGNALS_DEFAULT;
}

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MINUTES_PER_MONTH = 30 * MINUTES_PER_DAY;

/** Derive timeframe hint from window when not explicitly provided (e.g. "monthly" for 30-day window). */
function deriveTimeframeHintFromWindow(
  windowMinutes: number,
  explicitHint?: string | null
): string | undefined {
  if (explicitHint && typeof explicitHint === 'string' && explicitHint.trim()) {
    return explicitHint.trim();
  }
  if (windowMinutes >= MINUTES_PER_MONTH) return 'monthly';
  if (windowMinutes >= MINUTES_PER_WEEK) return 'weekly';
  if (windowMinutes >= MINUTES_PER_DAY) return 'daily';
  return undefined;
}

/** Compute news cutoff date from effective window: day → start of day, week → start of week (Mon UTC), month → start of month, year → start of year. */
function getNewsFromDateForWindow(effectiveWindowMinutes: number, now: Date): Date {
  if (effectiveWindowMinutes <= MINUTES_PER_DAY) {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    );
  }
  if (effectiveWindowMinutes <= 10 * MINUTES_PER_DAY) {
    const d = new Date(now);
    const day = d.getUTCDay();
    const daysToMonday = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - daysToMonday);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (effectiveWindowMinutes <= 35 * MINUTES_PER_DAY) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

/**
 * Service for building sentiment snapshots and context.
 */
export class SentimentService {
  constructor(private config: SentimentSnapshotConfig = getSentimentConfig()) {}

  /**
   * Build sentiment context for LLM consumption.
   *
   * Steps:
   * 1. Determine effective window
   * 2. Get asset class from market context
   * 3. Fetch raw signals from providers (parallel)
   * 4. Fetch raw signals from SentimentScore DB (legacy)
   * 5. Combine all signals
   * 6. Normalize all signals
   * 7. Aggregate to get SentimentScoreAggregate
   * 8. Compute by-source stats and drivers
   * 9. Build data quality flags
   * 10. Return SentimentContextForLLM
   */
  async buildSentimentContext(req: SentimentSnapshotRequest): Promise<SentimentContextForLLM> {
    const { symbol, windowMinutes, userId, timeframeHint } = req;

    // Step 1: Determine effective window and timeframe hint for market data
    const effectiveWindowMinutes = windowMinutes ?? this.config.windowMinutes;
    const effectiveTimeframeHint = deriveTimeframeHintFromWindow(
      effectiveWindowMinutes,
      timeframeHint
    );
    const now = new Date();
    const from = new Date(now.getTime() - effectiveWindowMinutes * 60 * 1000);
    const newsFromDate = getNewsFromDateForWindow(effectiveWindowMinutes, now);

    // Step 2: Get asset class from market context (needed for provider selection)
    // Use effectiveTimeframeHint so "sentiment for the month" requests monthly data and 30-day freshness
    let baseAssetClass: string | undefined;
    let assetClass: AssetClass | undefined;
    try {
      const marketContext = await marketContextService.getContext({
        symbol,
        timeframeHint: effectiveTimeframeHint ?? timeframeHint,
        rawQuery: `sentiment for ${symbol}`,
      } as MarketContextRequest);
      if (marketContext.contextAvailable && marketContext.context) {
        assetClass = marketContext.context.instrument.assetClass;
        baseAssetClass = assetClass;
      }
    } catch (error) {
      logger.warn('Failed to fetch market context for sentiment', {
        error: (error as Error).message,
        symbol,
      });
      // Continue without market context - infer asset class from symbol so we still call sentiment providers
    }

    // If we don't have asset class (e.g. market context failed due to rate limit), infer from symbol
    if (!assetClass && symbol) {
      assetClass = inferAssetClass(symbol);
      baseAssetClass = assetClass;
      logger.info('Inferred asset class for sentiment (market context unavailable)', {
        symbol,
        assetClass,
      });
    }

    // For FX bare currency codes (e.g. GBP), use canonical pair for providers; keep original for display
    const symbolForProviders =
      assetClass === 'FX' && isBareCurrencyCode(symbol)
        ? toCanonicalFxSymbol(symbol)
        : symbol;

    // Step 3: Fetch signals from providers (when we have an asset class)
    let providerSignals: RawSentimentSignal[] = [];
    if (assetClass) {
      try {
        const allProviders = getDefaultSentimentProviders();
        const relevantProviders = getProvidersForAssetClass(allProviders, assetClass);
        logger.debug('Relevant providers for asset class', {
          assetClass,
          providerNames: relevantProviders.map((p) => p.name),
        });

        if (relevantProviders.length > 0) {
          logger.debug('Fetching signals from providers', {
            symbol,
            assetClass,
            providerCount: relevantProviders.length,
            providers: relevantProviders.map((p) => p.name),
          });

          // Call all providers in parallel (use canonical FX symbol for providers when bare currency)
          const providerResults = await Promise.all(
            relevantProviders.map((provider) =>
              provider
                .fetchSignals({
                  symbol: symbolForProviders,
                  assetClass,
                  windowMinutes: effectiveWindowMinutes,
                  newsFromDate,
                  timeframeHint: effectiveTimeframeHint ?? timeframeHint,
                })
                .then((signals) => {
                  logger.info('Provider signals', {
                    provider: provider.name,
                    symbol,
                    assetClass,
                    signals: signals,
                  });
                  return signals;
                })
                .catch((error) => {
                  // Log error but don't fail the entire request
                  logger.warn('Provider failed to fetch signals', {
                    provider: provider.name,
                    symbol,
                    assetClass,
                    error: (error as Error).message,
                  });
                  return [] as RawSentimentSignal[];
                })
            )
          );

          // Concatenate all provider signals
          providerSignals = providerResults.flat();

          // Log per-provider signal counts so we can see why only some sources contribute
          const countsByProvider: Record<string, number> = {};
          relevantProviders.forEach((p, i) => {
            countsByProvider[p.name] = providerResults[i]?.length ?? 0;
          });
          logger.debug('Provider signal counts', {
            symbol,
            assetClass,
            countsByProvider,
            total: providerSignals.length,
          });
        }
      } catch (error) {
        logger.warn('Error fetching signals from providers', {
          error: (error as Error).message,
          symbol,
          assetClass,
        });
        // Continue with empty provider signals
      }
    }

    // Step 4: Fetch raw signals from SentimentScore DB (legacy support)
    const dbRecords = await SentimentScore.findAll({
      where: {
        symbol,
        timestamp: {
          [Op.gte]: from,
        },
      },
      order: [['timestamp', 'DESC']],
      limit: 1000, // Reasonable limit to avoid memory issues
    });

    // Step 5: Map DB rows to RawSentimentSignal[] and combine with provider signals
    const dbSignals = this.mapDbRecordsToRawSignals(dbRecords, symbol);
    const rawSignals = [...providerSignals, ...dbSignals];

    // Step 6: Normalize all signals
    const normalizedSignals = rawSignals.map(normalizeSignal);

    // Step 7: Aggregate to get SentimentScoreAggregate
    const aggregate = aggregateSignals(normalizedSignals, this.config);

    // Step 8: Compute by-source stats and drivers
    const bySourceStats = computeBySourceStats(normalizedSignals);
    const drivers = deriveDrivers(normalizedSignals);

    // Step 9: Build data quality flags (per-asset-class min signals)
    const dataQuality = this.buildDataQuality(
      normalizedSignals,
      effectiveWindowMinutes,
      this.config,
      assetClass
    );

    // Step 10: Build window description
    const windowDescription = this.buildWindowDescription(effectiveWindowMinutes);

    // Step 11: Get latest timestamp
    const latestTimestamp =
      normalizedSignals.length > 0
        ? normalizedSignals.reduce(
            (latest, signal) => (signal.timestamp > latest ? signal.timestamp : latest),
            normalizedSignals[0].timestamp
          )
        : null;

    // Return complete context
    return {
      symbol,
      baseAssetClass,
      windowDescription,
      aggregate,
      drivers,
      rawStats: {
        bySource: bySourceStats,
        latestTimestamp,
      },
      dataQuality,
    };
  }

  /**
   * Map SentimentScore DB records to RawSentimentSignal format.
   *
   * The existing SentimentScore model has:
   * - symbol, score, trend, drivers (JSONB), timestamp
   *
   * We need to infer:
   * - source: from drivers metadata or default to "aggregated"
   * - scaleMin/scaleMax: assume 0-100 for now (can be stored in drivers)
   * - weight: default 1.0
   * - label: from drivers array or null
   */
  private mapDbRecordsToRawSignals(
    records: SentimentScore[],
    symbol: string
  ): RawSentimentSignal[] {
    return records.map((record) => {
      // Extract metadata from drivers JSONB field
      const drivers = record.drivers as any;
      let source = 'aggregated';
      let label: string | null = null;
      let scaleMin = 0;
      let scaleMax = 100;

      if (drivers && typeof drivers === 'object') {
        // Check if drivers contains source metadata
        if (drivers.source && typeof drivers.source === 'string') {
          source = drivers.source;
        }
        // Check if drivers contains scale metadata
        if (typeof drivers.scaleMin === 'number') {
          scaleMin = drivers.scaleMin;
        }
        if (typeof drivers.scaleMax === 'number') {
          scaleMax = drivers.scaleMax;
        }
        // Extract label from first driver if available
        if (Array.isArray(drivers) && drivers.length > 0) {
          const firstDriver = drivers[0];
          if (firstDriver && typeof firstDriver === 'object') {
            label = firstDriver.text || firstDriver.label || null;
          } else if (typeof firstDriver === 'string') {
            label = firstDriver;
          }
        } else if (drivers.label && typeof drivers.label === 'string') {
          label = drivers.label;
        }
      }

      return {
        id: record.id,
        symbol: record.symbol,
        source,
        providerId: undefined,
        score: record.score,
        scaleMin,
        scaleMax,
        weight: 1.0, // Default weight
        timestamp: record.timestamp,
        label,
      };
    });
  }

  /**
   * Build data quality indicators.
   *
   * Includes new flags:
   * - PRICE_ONLY: All signals are from price_action provider
   * - SINGLE_SOURCE: All signals are from one provider
   * - NO_SIGNALS: No signals available at all
   */
  private buildDataQuality(
    signals: NormalizedSentimentSignal[],
    windowMinutes: number,
    config: SentimentSnapshotConfig,
    assetClass?: AssetClass
  ): import('./sentimentTypes').SentimentDataQuality {
    const minSignals = getMinSignals(assetClass);
    const hasEnoughSignals = signals.length >= minSignals;
    const sourcesAvailable = Array.from(new Set(signals.map((s) => s.source)));

    // Check if data is fresh (latest signal within last hour or 1/4 of window, whichever is smaller)
    const freshThresholdMinutes = Math.min(60, windowMinutes / 4);
    const now = new Date();
    const freshThreshold = new Date(now.getTime() - freshThresholdMinutes * 60 * 1000);

    const latestTimestamp =
      signals.length > 0
        ? signals.reduce(
            (latest, signal) => (signal.timestamp > latest ? signal.timestamp : latest),
            signals[0].timestamp
          )
        : null;

    const isFresh = latestTimestamp ? latestTimestamp >= freshThreshold : false;

    // Build issues array
    const issues: string[] = [];
    if (signals.length === 0) {
      issues.push('NO_SIGNALS');
    } else {
      if (!hasEnoughSignals) {
        issues.push('LOW_SIGNAL_COUNT');
      }
      if (!isFresh && latestTimestamp) {
        issues.push('STALE_DATA');
      }
      if (sourcesAvailable.length === 1) {
        issues.push('SINGLE_SOURCE');
        // If the only source is price_action, add PRICE_ONLY flag
        if (sourcesAvailable[0] === 'price_action') {
          issues.push('PRICE_ONLY');
        }
      }
    }

    return {
      hasEnoughSignals,
      signalsAvailable: signals.length,
      sourcesAvailable,
      windowMinutes,
      isFresh,
      issues,
    };
  }

  /**
   * Build human-friendly window description.
   */
  private buildWindowDescription(windowMinutes: number): string {
    if (windowMinutes < 60) {
      return `last ${windowMinutes} minutes`;
    } else if (windowMinutes < 1440) {
      const hours = Math.floor(windowMinutes / 60);
      return `last ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (windowMinutes < 43200) {
      const days = Math.floor(windowMinutes / 1440);
      return `last ${days} day${days !== 1 ? 's' : ''}`;
    } else {
      const years = Math.round(windowMinutes / 525600); // 365 * 24 * 60
      return `last ${years} year${years !== 1 ? 's' : ''}`;
    }
  }
}

// Export singleton instance
export const sentimentService = new SentimentService();
