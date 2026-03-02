/**
 * Crypto Fear & Greed Index Provider (Layer 2)
 * 
 * Fetches the Crypto Fear & Greed index from Alternative.me API
 * (or similar provider) to provide macro sentiment overlay for BTC
 * and optionally other major cryptocurrencies.
 */

import axios, { type AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { SentimentProvider, FetchSignalsArgs } from '../sentimentProvider';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';

/**
 * Crypto Fear & Greed index provider.
 * 
 * Fetches the latest Fear & Greed index value (0-100 scale) for BTC
 * and maps it to a sentiment signal.
 */
export class CryptoFearGreedProvider implements SentimentProvider {
  readonly name = 'crypto_fear_greed';
  private readonly timeoutMs = 10000; // 10 second timeout
  private readonly httpClient: AxiosInstance;
  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;

  /**
   * Mapping of internal symbols to supported crypto symbols.
   * For now, we support BTC/USD. Can be extended for ETH/USD, etc.
   */
  private readonly supportedSymbols: Record<string, string> = {
    'BTC/USD': 'BTC',
    'BTC': 'BTC',
    'ETH/USD': 'ETH',
    'ETH': 'ETH',
  };

  constructor(apiBaseUrl?: string, apiKey?: string) {
    // Use env vars or constructor params
    this.apiBaseUrl =
      apiBaseUrl ||
      env.CRYPTO_FG_API_BASE_URL ||
      'https://api.alternative.me/fng/';
    this.apiKey = apiKey || env.CRYPTO_FG_API_KEY;

    this.httpClient = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: this.timeoutMs,
    });
  }

  /**
   * Check if this provider supports the given asset class.
   * 
   * Fear & Greed index is only available for CRYPTO assets.
   */
  supports(assetClass: AssetClass): boolean {
    return assetClass === 'CRYPTO';
  }

  /**
   * Check if the symbol is supported.
   * 
   * @param symbol Internal symbol (e.g., 'BTC/USD', 'BTC')
   * @returns true if symbol is supported
   */
  private isSymbolSupported(symbol: string): boolean {
    const normalized = symbol.toUpperCase();
    return normalized in this.supportedSymbols;
  }

  /**
   * Map internal symbol to provider symbol format.
   * 
   * @param symbol Internal symbol (e.g., 'BTC/USD')
   * @returns Provider symbol (e.g., 'BTC')
   */
  private mapSymbol(symbol: string): string | null {
    const normalized = symbol.toUpperCase();
    return this.supportedSymbols[normalized] || null;
  }

  /** Discrete regime from 0-100 index: extreme fear -> extreme greed -> -1..1 */
  private regimeScore(value: number): number {
    if (value <= 20) return -1;
    if (value <= 40) return -0.5;
    if (value < 60) return 0;
    if (value < 80) return 0.5;
    return 1;
  }

  /**
   * Fetch 2-3 sentiment signals: level, regime, and optional delta.
   * 
   * @param args Arguments containing symbol, asset class, and time window
   * @returns Promise resolving to array of raw sentiment signals (usually 1 signal)
   */
  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass } = args;

    // Check if asset class is supported
    if (!this.supports(assetClass)) {
      logger.debug('Crypto Fear & Greed provider: asset class not supported', {
        symbol,
        assetClass,
      });
      return [];
    }

    // Check if symbol is supported
    if (!this.isSymbolSupported(symbol)) {
      logger.debug('Crypto Fear & Greed provider: symbol not supported', {
        symbol,
        assetClass,
      });
      return [];
    }

    const providerSymbol = this.mapSymbol(symbol);
    if (!providerSymbol) {
      return [];
    }

    try {
      // Alternative.me API endpoint structure:
      // GET https://api.alternative.me/fng/?limit=1
      // Response:
      // {
      //   "name": "Fear and Greed Index",
      //   "data": [
      //     {
      //       "value": "75",
      //       "value_classification": "Extreme Greed",
      //       "timestamp": "1234567890",
      //       "time_until_update": "12345"
      //     }
      //   ],
      //   "metadata": {
      //     "error": null
      //   }
      // }

      const queryParams: Record<string, string> = {
        limit: '2', // Latest + previous for delta signal
      };

      // Add API key if provided (some providers may require it)
      if (this.apiKey) {
        queryParams.api_key = this.apiKey;
      }

      logger.debug('Crypto Fear & Greed API request', {
        symbol,
        providerSymbol,
        apiBaseUrl: this.apiBaseUrl,
      });

      // Make API request with timeout
      const response = await Promise.race([
        this.httpClient.get('', { params: queryParams }),
        this.createTimeoutPromise(),
      ]);

      const json = response.data;

      // Check for errors in metadata
      if (json.metadata && json.metadata.error) {
        logger.warn('Crypto Fear & Greed provider: API error', {
          symbol,
          error: json.metadata.error,
        });
        return [];
      }

      // Parse response
      const data = json.data;
      if (!Array.isArray(data) || data.length === 0) {
        logger.debug('Crypto Fear & Greed provider: no data in response', {
          symbol,
        });
        return [];
      }

      const latestData = data[0];
      const indexValue = parseInt(latestData.value, 10);

      if (isNaN(indexValue) || indexValue < 0 || indexValue > 100) {
        logger.warn('Crypto Fear & Greed provider: invalid index value', {
          symbol,
          value: latestData.value,
        });
        return [];
      }

      let timestamp: Date;
      try {
        const timestampSeconds = parseInt(latestData.timestamp, 10);
        timestamp = new Date(timestampSeconds * 1000);
      } catch {
        timestamp = new Date();
      }

      const previousValue: number | undefined =
        data.length >= 2 ? parseInt(data[1].value, 10) : undefined;
      const prevValid =
        typeof previousValue === 'number' &&
        !isNaN(previousValue) &&
        previousValue >= 0 &&
        previousValue <= 100;

      const base: Omit<RawSentimentSignal, 'score' | 'scaleMin' | 'scaleMax' | 'dimension' | 'details'> = {
        id: randomUUID(),
        symbol,
        source: this.name,
        weight: 1.0,
        timestamp,
        label: 'fear_greed_index',
      };

      // Level: map 0-100 to -1..1
      const levelScore = (indexValue - 50) / 50;
      const signals: RawSentimentSignal[] = [
        {
          ...base,
          id: randomUUID(),
          score: levelScore,
          scaleMin: -1,
          scaleMax: 1,
          dimension: 'fg_level',
          details: { value: indexValue },
        },
        // Regime: discrete bands
        {
          ...base,
          id: randomUUID(),
          score: this.regimeScore(indexValue),
          scaleMin: -1,
          scaleMax: 1,
          dimension: 'fg_regime',
        },
      ];

      if (prevValid && previousValue !== undefined) {
        const delta = indexValue - previousValue;
        const deltaScore = Math.tanh(delta / 10);
        signals.push({
          ...base,
          id: randomUUID(),
          score: deltaScore,
          scaleMin: -1,
          scaleMax: 1,
          dimension: 'fg_delta',
          details: { delta },
        });
      }

      logger.debug('Crypto Fear & Greed provider: generated signals', {
        symbol,
        providerSymbol,
        indexValue,
        count: signals.length,
        valueClassification: latestData.value_classification,
      });

      return signals;
    } catch (error) {
      // Log error but return empty array (graceful degradation)
      if ((error as any).code === 'ECONNABORTED' || (error as Error).message.includes('timeout')) {
        logger.warn('Crypto Fear & Greed provider: request timeout', {
          symbol,
          timeoutMs: this.timeoutMs,
        });
      } else {
        logger.warn('Crypto Fear & Greed provider error', {
          error: (error as Error).message,
          symbol,
        });
      }
      return [];
    }
  }

  /**
   * Create a timeout promise that rejects after timeoutMs.
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Crypto Fear & Greed request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }
}
