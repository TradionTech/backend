import type { MarketContextRequest, RawMarketData } from '../../../types/market';
import { MarketDataProvider } from '../marketDataProvider';
import { marketData } from '../marketData';
import { inferAssetClass } from '../assetClassInferrer';
import { mapTimeframeHint, getDefaultTimeframe } from '../timeframeMapper';
import { logger } from '../../../config/logger';

/**
 * Real market data provider that wraps the existing marketData service.
 *
 * This provider:
 * - Uses the unified external Market Data API (configured via MARKET_API_BASE_URL)
 * - Handles authentication via MARKET_API_KEY
 * - Maps external API responses to RawMarketData format
 * - Handles errors, timeouts, and rate limiting gracefully
 */
export class RealMarketDataProvider implements MarketDataProvider {
  private readonly timeoutMs = 10000; // 10 second timeout

  /**
   * Get a snapshot of real market data from the external API.
   */
  async getSnapshot(request: MarketContextRequest): Promise<RawMarketData> {
    if (!request.symbol) {
      throw new Error('Symbol is required for real market data');
    }

    const symbol = request.symbol;
    const assetClass = request.assetClass || inferAssetClass(symbol);

    try {
      // Determine timeframe for API request
      const timeframe = request.timeframeHint
        ? mapTimeframeHint(request.timeframeHint)
        : getDefaultTimeframe(assetClass);

      const timeframeString = timeframe ? `${timeframe.size}${timeframe.unit}` : '1H'; // Default

      // Call the existing marketData service
      const apiResponse = await Promise.race([
        marketData.getPrices({
          symbols: [symbol],
          timeframe: timeframeString,
          limit: 100, // Get last 100 candles
        }),
        this.createTimeoutPromise(),
      ]);

      // Map API response to RawMarketData format
      return this.mapApiResponseToRawData(apiResponse, symbol, assetClass, request);
    } catch (error) {
      logger.error('Real market data provider error', {
        error: (error as Error).message,
        symbol,
        assetClass,
      });

      // Re-throw with context
      throw new Error(`Failed to fetch market data for ${symbol}: ${(error as Error).message}`);
    }
  }

  /**
   * Create a timeout promise that rejects after timeoutMs.
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Market data request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }

  /**
   * Map the external API response to RawMarketData format.
   *
   * The API response structure may vary, so this method handles common formats.
   */
  private mapApiResponseToRawData(
    apiResponse: any,
    symbol: string,
    assetClass: string,
    request: MarketContextRequest
  ): RawMarketData {
    // The API response structure from marketData.getPrices() may vary
    // This is a flexible mapper that handles common formats

    // Try to extract data from response
    // Common formats:
    // 1. { data: [{ symbol, candles: [...], price: ... }] }
    // 2. { [symbol]: { candles: [...], price: ... } }
    // 3. { candles: [...], price: ... } (single symbol response)

    let candles: RawMarketData['candles'];
    let lastPrice: number | undefined;
    let timestamp: number | undefined;

    // Handle array response
    if (Array.isArray(apiResponse)) {
      const symbolData = apiResponse.find((item: any) => item.symbol === symbol) || apiResponse[0];
      if (symbolData) {
        candles = this.mapCandles(symbolData.candles || symbolData.data);
        lastPrice = symbolData.price || symbolData.lastPrice || symbolData.close;
        timestamp = symbolData.timestamp || Date.now();
      }
    }
    // Handle object response with symbol key
    else if (apiResponse[symbol]) {
      const symbolData = apiResponse[symbol];
      candles = this.mapCandles(symbolData.candles || symbolData.data);
      lastPrice = symbolData.price || symbolData.lastPrice || symbolData.close;
      timestamp = symbolData.timestamp || Date.now();
    }
    // Handle direct response
    else if (apiResponse.candles || apiResponse.data) {
      candles = this.mapCandles(apiResponse.candles || apiResponse.data);
      lastPrice = apiResponse.price || apiResponse.lastPrice || apiResponse.close;
      timestamp = apiResponse.timestamp || Date.now();
    }
    // Fallback: try to extract from any structure
    else {
      // If we can't parse, create minimal response
      logger.warn('Unable to parse market data API response', {
        symbol,
        responseKeys: Object.keys(apiResponse),
      });

      candles = [];
      lastPrice = undefined;
      timestamp = Date.now();
    }

    // Extract base/quote for FX pairs
    let base: string | undefined;
    let quote: string | undefined;
    if (assetClass === 'FX' && symbol.length >= 6) {
      const match = symbol.match(/^([A-Z]{3})([A-Z]{3})$/);
      if (match) {
        base = match[1];
        quote = match[2];
      }
    }

    return {
      symbol,
      assetClass: assetClass as any,
      candles,
      lastPrice,
      timestamp: timestamp || Date.now(),
      provider: 'real',
      base,
      quote,
    };
  }

  /**
   * Map candles from API format to RawMarketData format.
   * Handles various candle formats:
   * - Array of [timestamp, open, high, low, close, volume]
   * - Array of { timestamp, open, high, low, close, volume }
   */
  private mapCandles(apiCandles: any): RawMarketData['candles'] {
    if (!apiCandles || !Array.isArray(apiCandles)) {
      return [];
    }

    return apiCandles
      .map((candle: any) => {
        // Handle array format [timestamp, open, high, low, close, volume?]
        if (Array.isArray(candle)) {
          return {
            timestamp: candle[0],
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: candle[5],
          };
        }

        // Handle object format { timestamp, open, high, low, close, volume? }
        if (typeof candle === 'object' && candle !== null) {
          return {
            timestamp: candle.timestamp || candle.time || candle.ts || Date.now(),
            open: candle.open || candle.o,
            high: candle.high || candle.h,
            low: candle.low || candle.l,
            close: candle.close || candle.c,
            volume: candle.volume || candle.v,
          };
        }

        // Unknown format, skip
        return null;
      })
      .filter((candle: any) => candle !== null) as RawMarketData['candles'];
  }
}
