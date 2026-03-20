/**
 * Finnhub General News Provider (FX, Crypto, and EQUITY)
 *
 * - FX/Crypto: uses Market News API per https://finnhub.io/docs/api/market-news
 *   GET /news?category=forex or category=crypto
 * - EQUITY: uses Company News API per https://finnhub.io/docs/api/company-news
 *   GET /company-news?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Applies lightweight lexicon-based sentiment to headlines/summaries.
 * For FX/CRYPTO market-news categories, we avoid strict symbol filtering and
 * instead down-weight less relevant headlines so category context is retained.
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

function computeRelevanceScore(textUpper: string, terms: Set<string>): number {
  if (terms.size === 0) return 0;
  const hits = [...terms].reduce((acc, term) => (textUpper.includes(term) ? acc + 1 : acc), 0);
  return Math.min(1, hits / Math.max(1, terms.size));
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

      return this.articlesToSignals(articles, symbol, cutoff, terms, false);
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
    return this.articlesToSignals(articles, symbol, cutoff, new Set<string>([symbol.toUpperCase()]), true);
  }

  private articlesToSignals(
    articles: FinnhubNewsItem[],
    symbol: string,
    cutoff: number,
    terms: Set<string>,
    isCompanyNews: boolean
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
      const textUpper = text.toUpperCase();
      const relevance = isCompanyNews ? 1 : computeRelevanceScore(textUpper, terms);

      const score = lexiconScore(text);
      const ageHours = Math.max(0, (Date.now() - ts) / 3600000);
      const recencyBoost = ageHours <= 12 ? 0.15 : 0;
      const relevanceBoost = relevance > 0 ? 0.3 : 0;
      const weight = Math.max(0.25, Math.min(1, 0.35 + recencyBoost + relevanceBoost));

      signals.push({
        ...base,
        id: randomUUID(),
        score,
        weight,
        timestamp: new Date(ts),
        dimension: 'headline_category_lexicon',
        details: {
          headline: article.headline,
          relevance,
          isCompanyNews,
        },
      });
    }

    return signals;
  }
}
