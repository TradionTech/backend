/**
 * Finnhub Equity News Sentiment Provider
 *
 * Uses Finnhub Company News API for stocks (free-tier compatible):
 * GET /company-news?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 */

import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { SentimentProvider, FetchSignalsArgs } from '../sentimentProvider';
import { createFinnhubClient } from './finnhubClient';
import { logger } from '../../../config/logger';

interface FinnhubCompanyNewsItem {
  id?: number;
  headline?: string;
  summary?: string;
  datetime?: number; // unix seconds
  url?: string;
}

const MAX_SIGNALS_PER_REQUEST = 10;
const POSITIVE_KEYWORDS = ['BEAT', 'RALLY', 'BULLISH', 'UPGRADE', 'SURGE', 'GROWTH', 'SOAR'];
const NEGATIVE_KEYWORDS = ['MISS', 'BEARISH', 'DOWNGRADE', 'PLUNGE', 'SLUMP', 'SELL-OFF', 'CUT'];

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function lexiconScore(text: string): number {
  const upper = text.toUpperCase();
  let score = 0;
  if (POSITIVE_KEYWORDS.some((k) => upper.includes(k))) score += 0.7;
  if (NEGATIVE_KEYWORDS.some((k) => upper.includes(k))) score -= 0.7;
  return Math.max(-1, Math.min(1, score));
}

export class FinnhubEquityNewsSentimentProvider implements SentimentProvider {
  readonly name = 'finnhub_equity_news';

  supports(assetClass: AssetClass): boolean {
    return assetClass === 'EQUITY';
  }

  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass, windowMinutes, newsFromDate } = args;

    try {
      const client = createFinnhubClient();
      const now = new Date();
      const from = newsFromDate ?? new Date(now.getTime() - windowMinutes * 60 * 1000);
      const { data: articles } = await client.get<FinnhubCompanyNewsItem[]>('/company-news', {
        params: {
          symbol: symbol.toUpperCase(),
          from: toDateString(from),
          to: toDateString(now),
        },
      });

      if (!Array.isArray(articles)) return [];

      const signals: RawSentimentSignal[] = [];
      const cutoffMs = from.getTime();
      for (const article of articles) {
        if (signals.length >= MAX_SIGNALS_PER_REQUEST) break;
        const ts = article.datetime != null ? article.datetime * 1000 : null;
        if (ts == null || ts < cutoffMs) continue;

        const text = `${article.headline || ''} ${article.summary || ''}`;
        const score = lexiconScore(text);
        const ageHours = Math.max(0, (now.getTime() - ts) / 3600000);
        const recencyBoost = ageHours <= 12 ? 0.15 : 0;
        const weight = Math.max(0.35, Math.min(1, 0.6 + recencyBoost));
        signals.push({
          id: randomUUID(),
          symbol,
          source: this.name,
          scaleMin: -1,
          scaleMax: 1,
          weight,
          timestamp: new Date(ts),
          score,
          label: 'company_news',
          dimension: 'company_news_lexicon',
          details: { headline: article.headline, url: article.url },
        });
      }

      return signals;
    } catch (err) {
      logger.warn('Finnhub equity news provider error', {
        error: (err as Error).message,
        symbol,
        assetClass,
      });
      return [];
    }
  }
}
