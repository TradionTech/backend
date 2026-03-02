/**
 * Price Action Sentiment Provider (Layer 1 Fallback)
 *
 * Uses recent price action (returns) across multiple timeframes to produce
 * up to three sentiment signals (short, medium, long). Always available
 * as long as price data exists.
 *
 * Horizons follow a cascading rule: for any requested timeframe, we request
 * three horizons — one step below (micro), the requested level (mid), and one
 * step above (macro) — so the system looks at both micro and macro.
 */

import { randomUUID } from 'crypto';
import type { AssetClass } from '../../../types/market';
import type { RawSentimentSignal } from '../sentimentTypes';
import type { SentimentProvider, FetchSignalsArgs } from '../sentimentProvider';
import { marketContextService } from '../../../services/market/marketContextService';
import { logger } from '../../../config/logger';
import type { PriceSnapshot } from '../../../types/market';

/** Ordered timeframe ladder (smallest → largest). Cascade = (R-1, R, R+1) clamped. */
const TIMEFRAME_LADDER = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  'daily',
  'weekly',
  'monthly',
] as const;

const LADDER_LENGTH = TIMEFRAME_LADDER.length;
const DEFAULT_LADDER_INDEX = TIMEFRAME_LADDER.indexOf('daily'); // 1h, 4h, daily when no hint

/** Alias map: hint string → ladder key (lowercase). */
const HINT_TO_LADDER_KEY: Record<string, string> = {
  monthly: 'monthly',
  month: 'monthly',
  weekly: 'weekly',
  week: 'weekly',
  daily: 'daily',
  day: 'daily',
  '1h': '1h',
  '1hr': '1h',
  h1: '1h',
  '4h': '4h',
  '4hr': '4h',
  h4: '4h',
  '1m': '1m',
  m1: '1m',
  '5m': '5m',
  m5: '5m',
  '15m': '15m',
  m15: '15m',
  '30m': '30m',
  m30: '30m',
  intraday: '1h',
};

/**
 * Map timeframe hint to index in the ladder. Unrecognized or missing → daily index.
 */
export function normalizeToLadderIndex(hint: string | undefined): number {
  if (hint == null || typeof hint !== 'string') {
    return DEFAULT_LADDER_INDEX;
  }
  const normalized = hint.trim().toLowerCase();
  const key = HINT_TO_LADDER_KEY[normalized] ?? HINT_TO_LADDER_KEY[hint.trim()] ?? null;
  if (key === null) {
    return DEFAULT_LADDER_INDEX;
  }
  const index = TIMEFRAME_LADDER.indexOf(key as (typeof TIMEFRAME_LADDER)[number]);
  return index >= 0 ? index : DEFAULT_LADDER_INDEX;
}

/** Dimensions for the three horizons (micro, mid, macro). */
const DIMENSIONS = ['momentum_short', 'momentum_medium', 'momentum_long'] as const;

const DAILY_INDEX = 6; // index of 'daily' in ladder

/** Weight for the horizon that matches the user's requested timeframe (e.g. monthly when they asked for monthly). */
const PRIMARY_HORIZON_WEIGHT = 1.0;
/** Weight for the other two horizons in the cascade (micro/macro context). */
const CONTEXT_HORIZON_WEIGHT = 0.25;

/**
 * Index into the 3-element horizons array that is the "requested" timeframe.
 * For daily and above: requested is the largest horizon (index 2). For intraday: requested is the middle (index 1).
 */
export function getPrimaryHorizonIndex(requestedIndex: number): number {
  return requestedIndex >= DAILY_INDEX ? 2 : 1;
}

/**
 * Return three horizons: for daily and above use (R-2, R-1, R); for intraday use (R-1, R, R+1).
 * Clamped to ladder bounds. Edge case: R=0 → (0, 0, 1) for 1m, 1m, 5m.
 */
export function getCascadingHorizons(
  requestedIndex: number
): Array<{ timeframeHint: string; dimension: string }> {
  let lo: number;
  let mid: number;
  let hi: number;
  if (requestedIndex === 0) {
    lo = 0;
    mid = 0;
    hi = 1;
  } else if (requestedIndex >= DAILY_INDEX) {
    lo = Math.max(0, requestedIndex - 2);
    mid = requestedIndex - 1;
    hi = requestedIndex;
  } else {
    lo = requestedIndex - 1;
    mid = requestedIndex;
    hi = Math.min(LADDER_LENGTH - 1, requestedIndex + 1);
  }
  lo = Math.max(0, lo);
  mid = Math.max(0, Math.min(mid, LADDER_LENGTH - 1));
  hi = Math.min(LADDER_LENGTH - 1, hi);
  const indices = [lo, mid, hi];
  return indices.map((i, pos) => ({
    timeframeHint: TIMEFRAME_LADDER[i],
    dimension: DIMENSIONS[pos],
  }));
}

export class PriceActionSentimentProvider implements SentimentProvider {
  readonly name = 'price_action';

  /** 5% move ≈ max bullish sentiment */
  private readonly returnScale: number = 0.05;
  private readonly defaultWindowMinutes: number = 240;

  supports(assetClass: AssetClass): boolean {
    return ['FX', 'CRYPTO', 'EQUITY', 'INDEX', 'FUTURES'].includes(assetClass);
  }

  /**
   * Build one raw signal from a price snapshot and dimension.
   */
  private signalFromSnapshot(
    symbol: string,
    priceSnapshot: PriceSnapshot,
    dimension: string
  ): RawSentimentSignal | null {
    let returnValue: number | null = null;
    if (priceSnapshot.changePct !== undefined) {
      returnValue = priceSnapshot.changePct / 100;
    } else if (priceSnapshot.open !== undefined && priceSnapshot.close !== undefined) {
      returnValue = (priceSnapshot.close - priceSnapshot.open) / priceSnapshot.open;
    } else if (priceSnapshot.last !== undefined && priceSnapshot.open !== undefined) {
      returnValue = (priceSnapshot.last - priceSnapshot.open) / priceSnapshot.open;
    }
    if (returnValue === null) return null;
    const rawSentiment = returnValue / this.returnScale;
    const score = Math.max(-1, Math.min(1, rawSentiment));
    return {
      id: randomUUID(),
      symbol,
      source: this.name,
      score,
      scaleMin: -1,
      scaleMax: 1,
      weight: 0.5,
      timestamp: new Date(priceSnapshot.timestamp),
      label: 'price_momentum',
      dimension,
      details: { ret: returnValue },
    };
  }

  /**
   * Fetch up to three sentiment signals (short / medium / long timeframe).
   */
  async fetchSignals(args: FetchSignalsArgs): Promise<RawSentimentSignal[]> {
    const { symbol, assetClass, windowMinutes, timeframeHint } = args;
    const effectiveWindowMinutes = windowMinutes || this.defaultWindowMinutes;
    const requestedIndex = normalizeToLadderIndex(timeframeHint);
    const horizons = getCascadingHorizons(requestedIndex);

    logger.info('Horizons', { horizons });

    try {
      const requests = horizons.map((h) =>
        marketContextService.getContext({
          symbol,
          assetClass,
          timeframeHint: h.timeframeHint,
          rawQuery: `price data for ${symbol} ${h.timeframeHint}`,
        })
      );
      const results = await Promise.all(requests);

      logger.info('Results', { results });

      const signals: RawSentimentSignal[] = [];
      const primaryIndex = getPrimaryHorizonIndex(requestedIndex);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const horizon = horizons[i];
        if (!result.contextAvailable || !result.context?.priceSnapshot) continue;
        const signal = this.signalFromSnapshot(
          symbol,
          result.context.priceSnapshot,
          horizon.dimension
        );
        if (signal) {
          signal.weight = i === primaryIndex ? PRIMARY_HORIZON_WEIGHT : CONTEXT_HORIZON_WEIGHT;
          signals.push(signal);
        }
      }

      if (signals.length > 0) {
        logger.info('Price action provider: generated signals', {
          symbol,
          assetClass,
          count: signals.length,
          windowMinutes: effectiveWindowMinutes,
        });
      } else {
        logger.debug('Price action provider: no market context available', {
          symbol,
          assetClass,
        });
      }
      return signals;
    } catch (error) {
      logger.warn('Price action provider error', {
        error: (error as Error).message,
        symbol,
        assetClass,
      });
      return [];
    }
  }
}
