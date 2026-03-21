import type {
  MarketContextRequest,
  MarketContext,
  MarketContextResult,
  RawMarketData,
  TrendSignals,
  VolatilitySignals,
  PriceSnapshot,
  DataQuality,
  Timeframe,
} from '../../types/market';
import { MarketDataProvider } from './marketDataProvider';
import { DummyMarketDataProvider } from './providers/dummyMarketDataProvider';
import { RealMarketDataProvider } from './providers/realMarketDataProvider';
import { AlphaVantageProvider } from './providers/alphaVantageProvider';
import { TwelveDataProvider } from './providers/twelveDataProvider';
import { isPreciousMetalFxPair } from './preciousMetalFx';
import { marketContextIntentExtractor } from './marketContextIntentExtractor';
import { inferAssetClass, isBareCurrencyCode, toCanonicalFxSymbol } from './assetClassInferrer';
import { mapTimeframeHint, getDefaultTimeframe } from './timeframeMapper';
import { resolveMarketSymbol } from './symbolResolver';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Main service for building market context from user requests.
 *
 * Orchestrates:
 * 1. Extracting market context request from user message/metadata
 * 2. Fetching raw market data from provider
 * 3. Computing trend and volatility signals
 * 4. Checking data freshness
 * 5. Building structured MarketContext
 */
export class MarketContextService {
  private provider: MarketDataProvider;
  /** Used for ISO precious-metal FX pairs (XAUUSD, …) when Alpha Vantage lacks reliable OHLC. */
  private twelveDataProvider: TwelveDataProvider | null = null;

  constructor() {
    // Initialize provider based on env config
    const providerType = env.MARKET_DATA_PROVIDER || 'dummy';

    if (providerType === 'real') {
      this.provider = new RealMarketDataProvider();
    } else if (providerType === 'alpha_vantage') {
      if (!env.ALPHAVANTAGE_API_KEY) {
        logger.warn('ALPHAVANTAGE_API_KEY not set, falling back to dummy provider');
        this.provider = new DummyMarketDataProvider();
      } else {
        this.provider = new AlphaVantageProvider(
          env.ALPHAVANTAGE_API_KEY,
          env.ALPHAVANTAGE_BASE_URL
        );
      }
      if (env.TWELVE_DATA_API_KEY) {
        this.twelveDataProvider = new TwelveDataProvider(
          env.TWELVE_DATA_API_KEY,
          env.TWELVE_DATA_BASE_URL
        );
      }
    } else {
      this.provider = new DummyMarketDataProvider();
    }

    logger.info('MarketContextService initialized', {
      provider: providerType,
      twelveDataForPreciousMetals: !!this.twelveDataProvider,
    });
  }

  /**
   * Get market context for a request.
   *
   * @param request Market context request (may be partial, will be enriched)
   * @returns Market context result with structured data
   */
  async getContext(request: MarketContextRequest): Promise<MarketContextResult> {
    try {
      // Step 1: Enrich request with extraction if needed
      let enrichedRequest = request;

      // If no symbol but we have rawQuery, try to extract
      if (!request.symbol && request.rawQuery) {
        const extracted = await marketContextIntentExtractor.extractContextRequest(
          request.rawQuery,
          request as any
        );
        logger.info('marketContextIntentExtractor returned', { extracted });
        enrichedRequest = {
          ...request,
          ...extracted,
        };
      }

      // If still no symbol, context is not available
      if (!enrichedRequest.symbol) {
        return {
          contextAvailable: false,
          reason: 'NO_SYMBOL',
        };
      }

      // Step 1b: Resolve symbol typos / aliases / company names into canonical symbols
      const resolved = resolveMarketSymbol({
        symbol: enrichedRequest.symbol,
        assetClass: enrichedRequest.assetClass,
        rawQuery: enrichedRequest.rawQuery,
      });
      enrichedRequest = {
        ...enrichedRequest,
        symbol: resolved.symbol,
        assetClass: resolved.assetClass,
      };

      if (!enrichedRequest.symbol) {
        return {
          contextAvailable: false,
          reason: 'NO_SYMBOL',
        };
      }

      // Step 2: Infer asset class if not provided
      if (!enrichedRequest.assetClass) {
        enrichedRequest.assetClass = inferAssetClass(enrichedRequest.symbol);
      }

      // Map bare FX currency codes to canonical pair for providers (e.g. GBP -> GBPUSD)
      if (enrichedRequest.assetClass === 'FX' && isBareCurrencyCode(enrichedRequest.symbol)) {
        enrichedRequest.symbol = toCanonicalFxSymbol(enrichedRequest.symbol);
      }

      // Step 3: Fetch raw market data from provider
      let rawData: RawMarketData;
      try {
        const useTwelveData =
          this.twelveDataProvider != null &&
          enrichedRequest.assetClass === 'FX' &&
          !!enrichedRequest.symbol &&
          isPreciousMetalFxPair(enrichedRequest.symbol);

        rawData = useTwelveData
          ? await this.twelveDataProvider!.getSnapshot(enrichedRequest)
          : await this.provider.getSnapshot(enrichedRequest);
      } catch (error) {
        logger.error('Market data provider error', {
          error: (error as Error).message,
          symbol: enrichedRequest.symbol,
        });

        return {
          contextAvailable: false,
          reason: 'PROVIDER_ERROR',
          error: resolved.issues?.length
            ? `${(error as Error).message} (${resolved.issues.join(', ')})`
            : (error as Error).message,
        };
      }

      // Step 4: Build structured context from raw data
      const context = this.buildContext(rawData, enrichedRequest);

      return {
        contextAvailable: true,
        context,
      };
    } catch (error) {
      logger.error('Market context service error', {
        error: (error as Error).message,
        request,
      });

      return {
        contextAvailable: false,
        reason: 'SERVICE_ERROR',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Build structured MarketContext from raw market data.
   *
   * This is a pure, deterministic function that:
   * - Computes trend signals from price data
   * - Computes volatility signals
   * - Checks data freshness
   * - Builds the complete context object
   */
  buildContext(rawData: RawMarketData, request: MarketContextRequest): MarketContext {
    // Determine timeframe
    const timeframe = request.timeframeHint
      ? (mapTimeframeHint(request.timeframeHint) ?? getDefaultTimeframe(rawData.assetClass))
      : getDefaultTimeframe(rawData.assetClass);

    // Build price snapshot
    const priceSnapshot = this.buildPriceSnapshot(rawData);

    // Compute trend signals
    const trendSignals = this.computeTrendSignals(rawData);

    // Compute volatility signals
    const volatilitySignals = this.computeVolatilitySignals(rawData);

    // Check data quality (timeframe-aware freshness)
    const dataQuality = this.checkDataQuality(rawData, timeframe);

    // Build instrument info
    const instrument = {
      symbol: rawData.symbol,
      assetClass: rawData.assetClass,
      exchange: rawData.exchange,
      base: rawData.base,
      quote: rawData.quote,
    };

    return {
      instrument,
      timeframe,
      priceSnapshot,
      trendSignals,
      volatilitySignals,
      dataQuality,
    };
  }

  /**
   * Build price snapshot from raw data.
   */
  private buildPriceSnapshot(rawData: RawMarketData): PriceSnapshot | undefined {
    if (!rawData.candles || rawData.candles.length === 0) {
      // If no candles, use lastPrice if available
      if (rawData.lastPrice) {
        return {
          last: rawData.lastPrice,
          timestamp: rawData.timestamp || Date.now(),
        };
      }
      return undefined;
    }

    // Use most recent candle
    const latestCandle = rawData.candles[rawData.candles.length - 1];
    const oldestCandle = rawData.candles[0];

    // Calculate change percentage (if we have multiple candles)
    let changePct: number | undefined;
    if (rawData.candles.length > 1) {
      const oldClose = oldestCandle.close;
      const newClose = latestCandle.close;
      changePct = ((newClose - oldClose) / oldClose) * 100;
    }

    // Find high/low across all candles
    const highs = rawData.candles.map((c) => c.high);
    const lows = rawData.candles.map((c) => c.low);
    const high = Math.max(...highs);
    const low = Math.min(...lows);

    return {
      last: latestCandle.close,
      changePct,
      high,
      low,
      open: oldestCandle.open,
      close: latestCandle.close,
      timestamp: latestCandle.timestamp,
    };
  }

  /**
   * Compute trend signals from price data.
   *
   * Uses simple comparison between recent and older closes.
   * Can be enhanced with linear regression or more sophisticated methods.
   */
  private computeTrendSignals(rawData: RawMarketData): TrendSignals | undefined {
    if (!rawData.candles || rawData.candles.length < 2) {
      return undefined;
    }

    const candles = rawData.candles;
    const totalCandles = candles.length;

    // Compare last 25% vs first 25% of candles for trend
    const recentCount = Math.max(1, Math.floor(totalCandles * 0.25));
    const olderCount = Math.max(1, Math.floor(totalCandles * 0.25));

    const recentCandles = candles.slice(-recentCount);
    const olderCandles = candles.slice(0, olderCount);

    const recentAvg = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
    const olderAvg = olderCandles.reduce((sum, c) => sum + c.close, 0) / olderCandles.length;

    const change = recentAvg - olderAvg;
    const changePct = (change / olderAvg) * 100;

    // Classify trend
    let trend: 'up' | 'down' | 'sideways';
    if (changePct > 1) {
      trend = 'up';
    } else if (changePct < -1) {
      trend = 'down';
    } else {
      trend = 'sideways';
    }

    // Determine basis (short/medium/long term based on number of candles)
    let basis: 'short_term' | 'medium_term' | 'long_term';
    if (totalCandles < 20) {
      basis = 'short_term';
    } else if (totalCandles < 50) {
      basis = 'medium_term';
    } else {
      basis = 'long_term';
    }

    return { trend, basis };
  }

  /**
   * Compute volatility signals from price data.
   *
   * Uses standard deviation of returns as a proxy for volatility.
   */
  private computeVolatilitySignals(rawData: RawMarketData): VolatilitySignals | undefined {
    if (!rawData.candles || rawData.candles.length < 5) {
      return undefined;
    }

    // Calculate returns (percentage changes)
    const returns: number[] = [];
    for (let i = 1; i < rawData.candles.length; i++) {
      const prevClose = rawData.candles[i - 1].close;
      const currClose = rawData.candles[i].close;
      const ret = (currClose - prevClose) / prevClose;
      returns.push(ret);
    }

    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Convert to percentage
    const volatilityValue = stdDev * 100;

    // Classify volatility level
    // Thresholds can be adjusted based on asset class
    let volatilityLevel: 'low' | 'medium' | 'high';
    if (volatilityValue < 0.5) {
      volatilityLevel = 'low';
    } else if (volatilityValue < 2.0) {
      volatilityLevel = 'medium';
    } else {
      volatilityLevel = 'high';
    }

    return {
      volatilityLevel,
      metric: 'std_dev',
      value: volatilityValue,
    };
  }

  /**
   * Check data quality (freshness, completeness).
   * Freshness threshold is timeframe-aware: e.g. monthly data is fresh if within ~30 days.
   */
  private checkDataQuality(rawData: RawMarketData, timeframe: Timeframe): DataQuality {
    const now = Date.now();
    const dataTimestamp = rawData.timestamp || now;
    const ageSeconds = (now - dataTimestamp) / 1000;

    const freshThresholdSeconds = this.getFreshThresholdSeconds(timeframe);
    const isFresh = ageSeconds < freshThresholdSeconds;

    const issues: string[] = [];

    // Merge provider-specific issues
    if (rawData.issues) {
      issues.push(...rawData.issues);
    }

    if (!isFresh) {
      issues.push('stale_data');
    }

    if (!rawData.candles || rawData.candles.length === 0) {
      issues.push('missing_candles');
    }

    return {
      isFresh,
      ageSeconds: isFresh ? undefined : ageSeconds,
      source: rawData.provider || 'unknown',
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  /**
   * Get freshness threshold in seconds based on timeframe.
   * Longer timeframes allow older data to still be considered "fresh".
   */
  private getFreshThresholdSeconds(timeframe: Timeframe): number {
    const MINUTE = 60;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    switch (timeframe.unit) {
      case 'M':
        return 5 * MINUTE;
      case 'H':
        return Math.max(1 * HOUR, timeframe.size * HOUR);
      case 'D':
        return Math.max(1 * DAY, timeframe.size * DAY);
      case 'W':
        return Math.max(7 * DAY, timeframe.size * 7 * DAY);
      case 'Mo':
        return Math.max(30 * DAY, timeframe.size * 30 * DAY);
      default:
        return 5 * MINUTE;
    }
  }
}

// Export singleton instance
export const marketContextService = new MarketContextService();
