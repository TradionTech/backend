/**
 * Finnhub General News Provider (FX, Crypto, and EQUITY)
 *
 * - FX/Crypto: uses Market News API per https://finnhub.io/docs/api/market-news
 *   GET /news?category=forex or category=crypto
 * - EQUITY: uses Company News API per https://finnhub.io/docs/api/company-news
 *   GET /company-news?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Applies lexicon-based sentiment to headlines/summaries.
 */

import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { SentimentProvider, FetchSignalsArgs } from '../sentimentProvider';
import { createFinnhubClient } from './finnhubClient';
import { logger } from '../../../config/logger';

const MAX_SIGNALS_PER_REQUEST = 10;

const POSITIVE_KEYWORDS = ['RALLY', 'BULLISH', 'RECOVERY', 'GAINS', 'UPGRADE', 'SURGE', 'SOAR'];
const NEGATIVE_KEYWORDS = [
  'CRASH',
  'BEARISH',
  'SELL-OFF',
  'DOWNGRADE',
  'SLUMP',
  'PLUNGE',
  'TUMBLE',
];

/** Market news item (GET /news) and company news item (GET /company-news) share these fields. */
interface FinnhubNewsItem {
  id?: number;
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number;
  /** Company news uses 'datetime' as Unix seconds; market news may use same. */
}

function lexiconScore(text: string): number {
  const upper = text.toUpperCase();
  let score = 0;
  if (POSITIVE_KEYWORDS.some((k) => upper.includes(k))) score += 0.7;
  if (NEGATIVE_KEYWORDS.some((k) => upper.includes(k))) score -= 0.7;
  return Math.max(-1, Math.min(1, score));
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export class FinnhubGeneralNewsProvider implements SentimentProvider {
  readonly name = 'finnhub_general_news';

  /** Supports FX, CRYPTO (market news) and EQUITY (company news). */
  supports(assetClass: AssetClass): boolean {
    return assetClass === 'FX' || assetClass === 'CRYPTO' || assetClass === 'EQUITY';
  }

  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass, newsFromDate } = args;

    try {
      const client = createFinnhubClient();
      const now = new Date();
      // Use newsFromDate when provided (dynamic by window: day/week/month/year), else start of current day (UTC)
      const startOfDay =
        newsFromDate ??
        new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
        );
      const cutoff = startOfDay.getTime();

      if (assetClass === 'EQUITY') {
        return this.fetchCompanyNews(client, symbol, startOfDay, now);
      }

      // FX / CRYPTO: Market News API per https://finnhub.io/docs/api/market-news
      const category = assetClass === 'FX' ? 'forex' : 'crypto';
      logger.info('Finnhub general news API request', {
        symbol,
        assetClass,
        category,
      });
      const { data: articles } = await client.get<FinnhubNewsItem[]>('/news', {
        params: { category, minId: 0 },
      });
      logger.info('Finnhub general news API response', {
        symbol,
        assetClass,
        articles: articles.length,
      });

      if (!Array.isArray(articles)) return [];

      const normalizedSymbol = symbol.replace('/', '').toUpperCase();
      const terms = new Set<string>([normalizedSymbol]);

      if (assetClass === 'FX' && symbol.length >= 6) {
        const base = symbol.slice(0, 3).toUpperCase();
        const quote = symbol.slice(3).replace('/', '').toUpperCase();
        terms.add(base);
        terms.add(quote);
      }

      if (assetClass === 'CRYPTO') {
        const base = symbol.split('/')[0]?.toUpperCase() || normalizedSymbol;
        terms.add(base);
        terms.add(base + 'USD');
        terms.add(base + 'USDT');
      }

      return this.articlesToSignals(articles, symbol, cutoff, terms, (text) =>
        [...terms].some((t) => text.includes(t))
      );
    } catch (err) {
      logger.warn('Finnhub general news provider error', {
        error: (err as Error).message,
        symbol,
        assetClass,
      });
      return [];
    }
  }

  /**
   * Company News API per https://finnhub.io/docs/api/company-news
   * GET /company-news?symbol=AAPL&from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  private async fetchCompanyNews(
    client: ReturnType<typeof createFinnhubClient>,
    symbol: string,
    from: Date,
    to: Date
  ): Promise<RawSentimentSignal[]> {
    const fromStr = toDateString(from);
    const toStr = toDateString(to);
    const { data: articles } = await client.get<FinnhubNewsItem[]>('/company-news', {
      params: { symbol: symbol.toUpperCase(), from: fromStr, to: toStr },
    });

    if (!Array.isArray(articles)) return [];

    const cutoff = from.getTime();
    const terms = new Set<string>([symbol.toUpperCase()]);
    return this.articlesToSignals(
      articles,
      symbol,
      cutoff,
      terms,
      () => true // company news is already filtered by symbol
    );
  }

  private articlesToSignals(
    articles: FinnhubNewsItem[],
    symbol: string,
    cutoff: number,
    terms: Set<string>,
    relevanceFilter: (text: string) => boolean
  ): RawSentimentSignal[] {
    const signals: RawSentimentSignal[] = [];
    const base = {
      symbol,
      source: this.name,
      scaleMin: -1,
      scaleMax: 1,
      weight: 0.8,
    };

    for (const article of articles) {
      if (signals.length >= MAX_SIGNALS_PER_REQUEST) break;

      const ts = article.datetime != null ? article.datetime * 1000 : null;
      if (ts == null || ts < cutoff) continue;

      const text = `${article.headline || ''} ${article.summary || ''}`;
      if (!relevanceFilter(text.toUpperCase())) continue;

      const score = lexiconScore(text);
      if (score === 0) continue;

      signals.push({
        ...base,
        id: randomUUID(),
        score,
        timestamp: new Date(ts),
        dimension: 'headline_lexicon',
        details: { headline: article.headline },
      });
    }

    return signals;
  }
}
