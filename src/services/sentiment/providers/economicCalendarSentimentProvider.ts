import { Op } from 'sequelize';
import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { FetchSignalsArgs, SentimentProvider } from '../sentimentProvider';
import { EconomicEvent } from '../../../db/models/EconomicEvent';
import { logger } from '../../../config/logger';

const MAX_EVENTS_PER_REQUEST = 12;

const VOLATILITY_MAGNITUDE: Record<string, number> = {
  HIGH: 0.55,
  MEDIUM: 0.35,
  LOW: 0.2,
  NONE: 0.1,
};

function parseFxCurrencies(symbol: string): string[] {
  const normalized = symbol.replace(/[\s\/\-_]/g, '').toUpperCase();
  const base = normalized.slice(0, 3);
  const quote = normalized.slice(3, 6);
  return [base, quote].filter((c) => c.length === 3);
}

function parseCryptoRelevantCurrencies(symbol: string): string[] {
  const [_, quoteRaw] = symbol.toUpperCase().split('/');
  const quote = (quoteRaw || 'USD').replace(/[\s\-_]/g, '');
  return [quote, 'USD'].filter((c, idx, arr) => c.length >= 3 && arr.indexOf(c) === idx);
}

function eventScore(event: EconomicEvent): number {
  const magnitude = VOLATILITY_MAGNITUDE[(event.volatility || 'NONE').toUpperCase()] ?? 0.1;
  if (event.isBetterThanExpected === true) return magnitude;
  if (event.isBetterThanExpected === false) return -magnitude;
  return 0;
}

function eventWeight(event: EconomicEvent): number {
  const magnitude = VOLATILITY_MAGNITUDE[(event.volatility || 'NONE').toUpperCase()] ?? 0.1;
  return Math.max(0.3, Math.min(1, 0.45 + magnitude));
}

export class EconomicCalendarSentimentProvider implements SentimentProvider {
  readonly name = 'economic_calendar';

  supports(assetClass: AssetClass): boolean {
    return assetClass === 'FX' || assetClass === 'CRYPTO';
  }

  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass, windowMinutes } = args;
    const now = new Date();
    const from = new Date(now.getTime() - windowMinutes * 60 * 1000);
    const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
      const currencies =
        assetClass === 'FX' ? parseFxCurrencies(symbol) : parseCryptoRelevantCurrencies(symbol);

      if (currencies.length === 0) return [];

      const events = await EconomicEvent.findAll({
        where: {
          dateUtc: {
            [Op.gte]: from,
            [Op.lte]: to,
          },
          currencyCode: {
            [Op.in]: currencies,
          },
        },
        order: [['dateUtc', 'ASC']],
        limit: MAX_EVENTS_PER_REQUEST,
      });

      return events.map((event) => ({
        id: randomUUID(),
        symbol,
        source: this.name,
        providerId: event.eventId,
        score: eventScore(event),
        scaleMin: -1,
        scaleMax: 1,
        weight: eventWeight(event),
        timestamp: event.dateUtc,
        label: 'macro_event',
        dimension: 'economic_calendar_event',
        details: {
          eventName: event.name,
          currencyCode: event.currencyCode,
          volatility: event.volatility,
          isBetterThanExpected: event.isBetterThanExpected,
        },
      }));
    } catch (error) {
      logger.warn('Economic calendar sentiment provider error', {
        symbol,
        assetClass,
        error: (error as Error).message,
      });
      return [];
    }
  }
}
