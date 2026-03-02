import axios, { type AxiosInstance } from 'axios';
import type { MarketContextRequest, RawMarketData } from '../../../types/market';
import { MarketDataProvider } from '../marketDataProvider';
import { inferAssetClass } from '../assetClassInferrer';
import { mapTimeframeHint, getDefaultTimeframe } from '../timeframeMapper';
import {
  mapRequestToAlphaParams,
  parseTimeSeriesResponse,
  detectAlphaVantageError,
} from './alphaVantageQuirks';
import { logger } from '../../../config/logger';
import { withAlphaVantageThrottle } from '../../alphaVantageThrottle';

/**
 * Alpha Vantage market data provider.
 *
 * Implements MarketDataProvider interface using Alpha Vantage API.
 *
 * This provider:
 * - Handles authentication via API key
 * - Maps requests to Alpha Vantage function/interval parameters
 * - Parses Alpha Vantage-specific response formats
 * - Detects rate limits and errors
 * - Handles timeouts and network errors gracefully
 */
export class AlphaVantageProvider implements MarketDataProvider {
  private readonly timeoutMs = 10000; // 10 second timeout
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://www.alphavantage.co/query',
    httpClient?: AxiosInstance
  ) {
    if (!apiKey) {
      throw new Error('Alpha Vantage API key is required');
    }

    // Use provided client or create default axios instance
    this.httpClient =
      httpClient ||
      axios.create({
        baseURL: baseUrl,
        timeout: this.timeoutMs,
      });
  }

  /**
   * Get a snapshot of market data from Alpha Vantage API.
   *
   * @param request Market context request with symbol, timeframe, etc.
   * @returns Raw market data (candles, prices, etc.)
   * @throws Error if provider is unavailable or request fails
   */
  async getSnapshot(request: MarketContextRequest): Promise<RawMarketData> {
    // Validate symbol
    if (!request.symbol) {
      throw new Error('Symbol is required for Alpha Vantage market data');
    }

    const symbol = request.symbol;

    // Infer asset class if not provided
    const assetClass = request.assetClass || inferAssetClass(symbol);

    try {
      // Determine timeframe
      const timeframe = request.timeframeHint
        ? (mapTimeframeHint(request.timeframeHint) ?? undefined)
        : getDefaultTimeframe(assetClass);

      // Map request to Alpha Vantage API parameters
      const params = mapRequestToAlphaParams(request, timeframe, assetClass);

      // Build query parameters
      const queryParams: Record<string, string> = {
        apikey: this.apiKey,
        function: params.func,
        ...params.symbolParam,
        datatype: 'json',
        outputsize: 'compact', // Get last 100 data points
      };

      // Add interval for intraday functions
      if (params.interval) {
        queryParams.interval = params.interval;
      }

      // Make API request
      logger.debug('Alpha Vantage API request', {
        symbol,
        assetClass,
        func: params.func,
        interval: params.interval,
      });

      const response = await withAlphaVantageThrottle(() =>
        Promise.race([
          this.httpClient.get('', { params: queryParams }),
          this.createTimeoutPromise(),
        ])
      );

      const json = response.data;

      // Check for Alpha Vantage-specific errors
      const errorInfo = detectAlphaVantageError(json);
      if (errorInfo.isError) {
        const errorMessage = errorInfo.rawMessage || 'Unknown Alpha Vantage error';
        if (errorInfo.reason === 'RATE_LIMIT') {
          throw new Error(`Alpha Vantage rate limit: ${errorMessage}`);
        } else {
          throw new Error(`Alpha Vantage API error: ${errorMessage}`);
        }
      }

      // Parse response into RawMarketData
      const rawData = parseTimeSeriesResponse(json, params, symbol, assetClass);

      logger.debug('Alpha Vantage API response parsed', {
        symbol,
        timeframe,
        candlesCount: rawData.candles?.length || 0,
        hasIssues: !!rawData.issues?.length,
      });

      return rawData;
    } catch (error) {
      // Handle timeout errors
      if ((error as any).code === 'ECONNABORTED' || (error as Error).message.includes('timeout')) {
        logger.error('Alpha Vantage request timeout', {
          symbol,
          assetClass,
          timeoutMs: this.timeoutMs,
        });
        throw new Error(`Alpha Vantage request timed out after ${this.timeoutMs}ms`);
      }

      // Handle network errors
      if ((error as any).code === 'ENOTFOUND' || (error as any).code === 'ECONNREFUSED') {
        logger.error('Alpha Vantage network error', {
          symbol,
          assetClass,
          error: (error as Error).message,
        });
        throw new Error(`Alpha Vantage network error: ${(error as Error).message}`);
      }

      // Re-throw other errors with context
      logger.error('Alpha Vantage provider error', {
        symbol,
        assetClass,
        error: (error as Error).message,
      });

      throw new Error(
        `Failed to fetch Alpha Vantage data for ${symbol}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Create a timeout promise that rejects after timeoutMs.
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Alpha Vantage request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }
}
