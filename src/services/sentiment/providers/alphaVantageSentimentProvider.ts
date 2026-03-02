/**
 * Alpha Vantage News Sentiment Provider (Layer 2)
 *
 * Uses Alpha Vantage's NEWS_SENTIMENT API to fetch news articles with
 * sentiment scores for stocks, crypto, and FX assets.
 */

import axios, { type AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { SentimentProvider, FetchSignalsArgs } from '../sentimentProvider';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { withAlphaVantageThrottle } from '../../alphaVantageThrottle';

/**
 * Alpha Vantage news sentiment provider.
 *
 * Fetches news articles with sentiment scores from Alpha Vantage's
 * NEWS_SENTIMENT API endpoint.
 */
export class AlphaVantageNewsSentimentProvider implements SentimentProvider {
  readonly name = 'alpha_vantage_news';
  private readonly timeoutMs = 10000; // 10 second timeout
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || env.ALPHAVANTAGE_API_KEY;
    this.baseUrl = baseUrl || env.ALPHAVANTAGE_BASE_URL || 'https://www.alphavantage.co/query';

    if (!this.apiKey) {
      logger.warn('Alpha Vantage API key not configured for news sentiment provider');
    }

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
    });
  }

  /**
   * Check if this provider supports the given asset class.
   *
   * Alpha Vantage news sentiment supports EQUITY, CRYPTO, and FX.
   */
  supports(assetClass: AssetClass): boolean {
    return assetClass === 'EQUITY' || assetClass === 'CRYPTO' || assetClass === 'FX';
  }

  /**
   * For FX and crypto, Alpha Vantage expects 3-letter currency codes (EUR, USD, BTC), not pairs.
   * Returns comma-separated tickers for a single request, e.g. "FOREX:EUR,FOREX:USD" or "CRYPTO:BTC,FOREX:USD".
   * Also returns the set of normalized codes we requested (for matching ticker_sentiment in the response).
   */
  private mapSymbolToAlphaVantageTickers(
    symbol: string,
    assetClass: AssetClass
  ): { tickersParam: string; requestedCodes: Set<string> } {
    if (assetClass === 'EQUITY') {
      const s = symbol.toUpperCase();
      return { tickersParam: s, requestedCodes: new Set([s]) };
    }
    if (assetClass === 'FX') {
      const pair = symbol.replace(/[\s\/\-_]/g, '').toUpperCase();
      const base = pair.slice(0, 3);
      const quote = pair.slice(3);
      const codes = [base, quote].filter((c) => c.length >= 2);
      const tickersParam = codes.map((c) => `FOREX:${c}`).join(',');
      return { tickersParam: tickersParam || `FOREX:${pair}`, requestedCodes: new Set(codes) };
    }
    if (assetClass === 'CRYPTO') {
      const parts = symbol.split('/').map((p) => p.replace(/\s/g, '').toUpperCase());
      const base = parts[0] || symbol.toUpperCase();
      const quote = parts[1] || 'USD';
      const tickers = [`CRYPTO:${base}`];
      if (quote.length >= 2 && quote.length <= 5) {
        tickers.push(`FOREX:${quote}`);
      }
      const requestedCodes = new Set([base, quote]);
      return { tickersParam: tickers.join(','), requestedCodes };
    }
    return { tickersParam: symbol.toUpperCase(), requestedCodes: new Set([symbol.toUpperCase()]) };
  }

  /**
   * Return whether a ticker from the API response is one of our requested codes (FX/crypto 3-letter or equity).
   */
  private tickerMatchesRequestedCodes(tickerFromApi: string, requestedCodes: Set<string>): boolean {
    const stripPrefix = (s: string) =>
      s
        .replace(/^(CRYPTO:|FOREX:)/i, '')
        .replace(/[\s\/\-_]/g, '')
        .toUpperCase();
    const code = stripPrefix(tickerFromApi);
    if (requestedCodes.has(code)) return true;
    // Also allow pair match for backward compatibility (e.g. EURUSD when we requested EUR,USD)
    if (code.length >= 4 && requestedCodes.size >= 2) {
      const all = [...requestedCodes].join('');
      if (stripPrefix(all) === code || code.includes(all)) return true;
    }
    return false;
  }

  /**
   * Fetch sentiment signals from Alpha Vantage news API.
   *
   * @param args Arguments containing symbol, asset class, and time window
   * @returns Promise resolving to array of raw sentiment signals
   */
  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass, windowMinutes } = args;

    // Check if API key is configured
    if (!this.apiKey) {
      logger.debug('Alpha Vantage news provider: API key not configured', {
        symbol,
        assetClass,
      });
      return [];
    }

    // Check if asset class is supported
    if (!this.supports(assetClass)) {
      logger.debug('Alpha Vantage news provider: asset class not supported', {
        symbol,
        assetClass,
      });
      return [];
    }

    try {
      // FX and crypto: pass 3-letter codes (FOREX:EUR,FOREX:USD or CRYPTO:BTC,FOREX:USD)
      const { tickersParam, requestedCodes } = this.mapSymbolToAlphaVantageTickers(
        symbol,
        assetClass
      );

      const queryParams: Record<string, string> = {
        function: 'NEWS_SENTIMENT',
        tickers: tickersParam,
        apikey: this.apiKey,
        limit: '50',
      };

      logger.info('Alpha Vantage news API request', {
        symbol,
        tickers: tickersParam,
        assetClass,
        windowMinutes,
      });

      // Make API request with timeout (throttled for free-tier rate limit)
      const response = await withAlphaVantageThrottle(() =>
        Promise.race([
          this.httpClient.get('', { params: queryParams }),
          this.createTimeoutPromise(),
        ])
      );

      const json = response.data;

      // Check for Alpha Vantage-specific errors
      if (json['Error Message'] || json['Note']) {
        const errorMessage = json['Error Message'] || json['Note'];
        if (errorMessage.includes('rate limit') || errorMessage.includes('API call frequency')) {
          logger.warn('Alpha Vantage news provider: rate limit', {
            symbol,
            assetClass,
            message: errorMessage,
          });
          return [];
        }
        logger.warn('Alpha Vantage news provider: API error', {
          symbol,
          assetClass,
          message: errorMessage,
        });
        return [];
      }

      // Parse response
      // Alpha Vantage NEWS_SENTIMENT response structure:
      // {
      //   "feed": [
      //     {
      //       "title": "...",
      //       "url": "...",
      //       "time_published": "...",
      //       "authors": [...],
      //       "summary": "...",
      //       "banner_image": "...",
      //       "source": "...",
      //       "category_within_source": "...",
      //       "source_domain": "...",
      //       "topics": [...],
      //       "overall_sentiment_score": 0.1234,
      //       "overall_sentiment_label": "Bullish",
      //       "ticker_sentiment": [
      //         {
      //           "ticker": "AAPL",
      //           "relevance_score": 0.5,
      //           "ticker_sentiment_score": 0.1234,
      //           "ticker_sentiment_label": "Bullish"
      //         }
      //       ]
      //     }
      //   ]
      // }

      const feed = json.feed;
      if (!Array.isArray(feed)) {
        logger.debug('Alpha Vantage news provider: no feed array in response', {
          symbol,
          assetClass,
        });
        return [];
      }

      // Filter articles by time: use newsFromDate when provided (dynamic by window), else start of current day (UTC)
      const now = new Date();
      const windowStart =
        args.newsFromDate ??
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const signals: RawSentimentSignal[] = [];

      for (const article of feed) {
        // Parse article timestamp
        let articleTime: Date;
        try {
          // Alpha Vantage format: "20240101T120000"
          const timeStr = article.time_published;
          if (!timeStr) continue;

          const year = parseInt(timeStr.substring(0, 4));
          const month = parseInt(timeStr.substring(4, 6)) - 1; // Month is 0-indexed
          const day = parseInt(timeStr.substring(6, 8));
          const hour = parseInt(timeStr.substring(9, 11));
          const minute = parseInt(timeStr.substring(11, 13));
          const second = parseInt(timeStr.substring(13, 15) || '0');

          articleTime = new Date(Date.UTC(year, month, day, hour, minute, second));
        } catch (error) {
          logger.debug('Alpha Vantage news provider: failed to parse article timestamp', {
            symbol,
            time_published: article.time_published,
          });
          continue;
        }

        // Skip articles outside the time window
        if (articleTime < windowStart) {
          logger.debug('Alpha Vantage news provider: article outside time window', {
            symbol,
            articleTime,
            windowStart,
          });
          continue;
        }

        // Extract sentiment score: use any ticker that matches our requested codes (e.g. EUR or USD for EURUSD)
        let sentimentScore: number | null = null;
        const tickerSentiment = article.ticker_sentiment;
        if (Array.isArray(tickerSentiment)) {
          const matching = tickerSentiment.filter(
            (t: any) => t.ticker && this.tickerMatchesRequestedCodes(t.ticker, requestedCodes)
          );
          logger.debug('Matching ticker length', {
            symbol,
            assetClass,
            matching: matching.length,
          });
          if (matching.length > 0) {
            // Use average of matching ticker scores when we requested multiple (e.g. EUR + USD)
            const sum = matching.reduce(
              (acc: number, t: any) =>
                acc +
                (Number.isNaN(Number(t.ticker_sentiment_score))
                  ? 0
                  : Number(t.ticker_sentiment_score)),
              0
            );
            sentimentScore = sum / matching.length;
          }
        }

        // Fallback to overall sentiment if ticker-specific not available
        if (sentimentScore === null && !Number.isNaN(Number(article.overall_sentiment_score))) {
          sentimentScore = Number(article.overall_sentiment_score);
        }

        // Skip if no sentiment score available
        if (sentimentScore === null) {
          continue;
        }

        // Alpha Vantage sentiment scores are typically in range -1 to 1
        // But we'll use the scale as documented and let normalizeSignal handle it
        const signal: RawSentimentSignal = {
          id: randomUUID(),
          symbol,
          source: this.name,
          providerId: article.url || article.title?.substring(0, 50),
          score: sentimentScore,
          scaleMin: -1,
          scaleMax: 1,
          weight: 1.0, // Full weight for targeted news signals
          timestamp: articleTime,
          label: 'news_headline',
        };

        signals.push(signal);
      }

      logger.debug('Alpha Vantage news provider: generated signals', {
        symbol,
        assetClass,
        signalsCount: signals.length,
        windowStart: windowStart.toISOString(),
      });

      return signals;
    } catch (error) {
      // Log error but return empty array (graceful degradation)
      if ((error as any).code === 'ECONNABORTED' || (error as Error).message.includes('timeout')) {
        logger.warn('Alpha Vantage news provider: request timeout', {
          symbol,
          assetClass,
          timeoutMs: this.timeoutMs,
        });
      } else {
        logger.warn('Alpha Vantage news provider error', {
          error: (error as Error).message,
          symbol,
          assetClass,
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
        reject(new Error(`Alpha Vantage news request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }
}
