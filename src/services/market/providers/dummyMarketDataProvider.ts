import type { MarketContextRequest, RawMarketData } from '../../../types/market';
import { MarketDataProvider } from '../marketDataProvider';
import { inferAssetClass } from '../assetClassInferrer';
import { mapTimeframeHint, getDefaultTimeframe } from '../timeframeMapper';

/**
 * Dummy market data provider for testing and local development.
 *
 * Returns deterministic, fake data that simulates real market data structure.
 *
 * TODO: Replace with real provider integration (e.g., broker API, exchange API, quotes service)
 *
 * This provider:
 * - Generates fake OHLCV candles based on symbol
 * - Returns predictable price data
 * - Simulates different asset classes
 * - Can be used for testing without external API dependencies
 */
export class DummyMarketDataProvider implements MarketDataProvider {
  /**
   * Get a snapshot of fake market data.
   *
   * Generates deterministic data based on symbol name hash for consistency.
   */
  async getSnapshot(request: MarketContextRequest): Promise<RawMarketData> {
    const symbol = request.symbol || 'EURUSD';
    const assetClass = request.assetClass || inferAssetClass(symbol);

    // Generate deterministic price based on symbol hash
    const basePrice = this.generateBasePrice(symbol);
    const timestamp = Date.now();

    // Generate candles (last 100 candles)
    const timeframe = request.timeframeHint
      ? (mapTimeframeHint(request.timeframeHint) ?? getDefaultTimeframe(assetClass))
      : getDefaultTimeframe(assetClass);

    const candles = this.generateCandles(basePrice, 100, timeframe);

    // Extract base/quote for FX pairs
    let base: string | undefined;
    let quote: string | undefined;
    if (assetClass === 'FX' && symbol.length >= 6) {
      // Try to split FX pair (e.g., EURUSD -> EUR, USD)
      const match = symbol.match(/^([A-Z]{3})([A-Z]{3})$/);
      if (match) {
        base = match[1];
        quote = match[2];
      }
    }

    return {
      symbol,
      assetClass,
      candles,
      lastPrice: basePrice,
      timestamp,
      provider: 'dummy',
      base,
      quote,
    };
  }

  /**
   * Generate a deterministic base price from symbol name.
   * Uses a simple hash to ensure consistency.
   */
  private generateBasePrice(symbol: string): number {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      const char = symbol.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Map hash to a reasonable price range based on asset class
    const assetClass = inferAssetClass(symbol);
    let minPrice: number;
    let maxPrice: number;

    switch (assetClass) {
      case 'FX':
        // FX pairs typically range from 0.5 to 2.0
        minPrice = 0.5;
        maxPrice = 2.0;
        break;
      case 'CRYPTO':
        // Crypto can range widely, use 10-100000
        minPrice = 10;
        maxPrice = 100000;
        break;
      case 'EQUITY':
        // Equities typically 10-1000
        minPrice = 10;
        maxPrice = 1000;
        break;
      default:
        minPrice = 1;
        maxPrice = 100;
    }

    // Normalize hash to price range
    const normalized = (Math.abs(hash) % 10000) / 10000; // 0-1
    return minPrice + normalized * (maxPrice - minPrice);
  }

  /**
   * Generate fake OHLCV candles with realistic patterns.
   */
  private generateCandles(
    basePrice: number,
    count: number,
    timeframe?: { unit: string; size: number }
  ): RawMarketData['candles'] {
    const candles: RawMarketData['candles'] = [];
    const now = Date.now();

    // Determine candle duration in milliseconds
    let candleDurationMs = 60000; // Default 1 minute
    if (timeframe) {
      switch (timeframe.unit) {
        case 'M':
          candleDurationMs = timeframe.size * 60 * 1000;
          break;
        case 'H':
          candleDurationMs = timeframe.size * 60 * 60 * 1000;
          break;
        case 'D':
          candleDurationMs = timeframe.size * 24 * 60 * 60 * 1000;
          break;
        case 'W':
          candleDurationMs = timeframe.size * 7 * 24 * 60 * 60 * 1000;
          break;
      }
    }

    let currentPrice = basePrice;

    // Generate candles going backwards in time
    for (let i = count - 1; i >= 0; i--) {
      const timestamp = now - i * candleDurationMs;

      // Simulate price movement with random walk
      const change = (Math.random() - 0.5) * 0.02; // ±1% change
      currentPrice = currentPrice * (1 + change);

      const open = currentPrice;
      const volatility = Math.random() * 0.01; // 0-1% volatility
      const high = open * (1 + volatility);
      const low = open * (1 - volatility);
      const close = open * (1 + (Math.random() - 0.5) * 0.01);

      candles.push({
        timestamp,
        open,
        high: Math.max(open, high, close),
        low: Math.min(open, low, close),
        close,
        volume: Math.random() * 1000000,
      });

      currentPrice = close;
    }

    return candles;
  }
}
