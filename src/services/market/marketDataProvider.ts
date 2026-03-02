import type { MarketContextRequest, RawMarketData } from '../../types/market';

/**
 * Abstract interface for market data providers.
 * 
 * Implementations should handle:
 * - Authentication (API keys, etc.)
 * - Rate limiting
 * - Error handling and timeouts
 * - Mapping external API responses to RawMarketData format
 */
export interface MarketDataProvider {
  /**
   * Get a snapshot of market data for the given request.
   * 
   * @param request Market context request with symbol, timeframe, etc.
   * @returns Raw market data (candles, prices, etc.)
   * @throws Error if provider is unavailable or request fails
   */
  getSnapshot(request: MarketContextRequest): Promise<RawMarketData>;
}
