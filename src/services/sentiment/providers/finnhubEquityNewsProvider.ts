/**
 * Finnhub Equity News Sentiment Provider
 *
 * Uses Finnhub News Sentiment API for stocks: companyNewsScore,
 * bullish/bearish percent, and buzz.
 */

import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { SentimentProvider, FetchSignalsArgs } from '../sentimentProvider';
import { createFinnhubClient } from './finnhubClient';
import { logger } from '../../../config/logger';

interface FinnhubNewsSentimentResponse {
  companyNewsScore?: number;
  sectorAverageBullishPercent?: number;
  sectorAverageNewsScore?: number;
  sentiment?: {
    bullishPercent?: number;
    bearishPercent?: number;
  };
  buzz?: {
    articlesInLastWeek?: number;
    buzz?: number;
    weeklyAverage?: number;
  };
  symbol?: string;
}

export class FinnhubEquityNewsSentimentProvider implements SentimentProvider {
  readonly name = 'finnhub_equity_news';

  supports(assetClass: AssetClass): boolean {
    return assetClass === 'EQUITY';
  }

  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass, windowMinutes } = args;

    try {
      const client = createFinnhubClient();
      const { data } = await client.get<FinnhubNewsSentimentResponse>(
        '/news-sentiment',
        { params: { symbol: symbol.toUpperCase() } }
      );

      const now = new Date();
      const signals: RawSentimentSignal[] = [];
      const base: Omit<RawSentimentSignal, 'score' | 'dimension' | 'details'> = {
        id: randomUUID(),
        symbol,
        source: this.name,
        scaleMin: -1,
        scaleMax: 1,
        weight: 1.0,
        timestamp: now,
      };

      if (typeof data.companyNewsScore === 'number') {
        const score = data.companyNewsScore * 2 - 1;
        signals.push({
          ...base,
          id: randomUUID(),
          score: Math.max(-1, Math.min(1, score)),
          dimension: 'companyNewsScore',
        });
      }

      if (data.sentiment) {
        const { bullishPercent, bearishPercent } = data.sentiment;
        if (
          typeof bullishPercent === 'number' &&
          typeof bearishPercent === 'number'
        ) {
          const balance = bullishPercent - bearishPercent;
          signals.push({
            ...base,
            id: randomUUID(),
            score: Math.max(-1, Math.min(1, balance)),
            dimension: 'bull_vs_bear',
          });
        }
      }

      if (data.buzz && typeof data.buzz.buzz === 'number') {
        const attentionScore = Math.tanh((data.buzz.buzz - 1) / 0.5);
        signals.push({
          ...base,
          id: randomUUID(),
          score: Math.max(-1, Math.min(1, attentionScore)),
          dimension: 'buzz_intensity',
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
