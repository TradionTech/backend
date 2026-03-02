/**
 * Unit tests for PriceActionSentimentProvider.
 */

import {
  PriceActionSentimentProvider,
  normalizeToLadderIndex,
  getCascadingHorizons,
  getPrimaryHorizonIndex,
} from '../priceActionSentimentProvider';
import type { AssetClass } from '../../../../types/market';
import { marketContextService } from '../../../../services/market/marketContextService';

const EQUITY: AssetClass = 'EQUITY';

// Mock market context service
jest.mock('../../../../services/market/marketContextService', () => ({
  marketContextService: {
    getContext: jest.fn(),
  },
}));

describe('normalizeToLadderIndex', () => {
  it('should return daily index for undefined or empty', () => {
    const dailyIndex = 6; // daily is at index 6 in ladder
    expect(normalizeToLadderIndex(undefined)).toBe(dailyIndex);
    expect(normalizeToLadderIndex('')).toBe(dailyIndex);
  });

  it('should map daily/week/day to daily index', () => {
    expect(normalizeToLadderIndex('daily')).toBe(6);
    expect(normalizeToLadderIndex('day')).toBe(6);
  });

  it('should map weekly/week to weekly index', () => {
    expect(normalizeToLadderIndex('weekly')).toBe(7);
    expect(normalizeToLadderIndex('week')).toBe(7);
  });

  it('should map monthly/month to monthly index', () => {
    expect(normalizeToLadderIndex('monthly')).toBe(8);
    expect(normalizeToLadderIndex('month')).toBe(8);
  });

  it('should map 1h/H1/intraday to 1h index', () => {
    expect(normalizeToLadderIndex('1h')).toBe(4);
    expect(normalizeToLadderIndex('H1')).toBe(4);
    expect(normalizeToLadderIndex('intraday')).toBe(4);
  });

  it('should map 4h/H4 to 4h index', () => {
    expect(normalizeToLadderIndex('4h')).toBe(5);
    expect(normalizeToLadderIndex('H4')).toBe(5);
  });

  it('should map 15m/M15 to 15m index', () => {
    expect(normalizeToLadderIndex('15m')).toBe(2);
    expect(normalizeToLadderIndex('M15')).toBe(2);
  });

  it('should return daily index for unknown hint', () => {
    expect(normalizeToLadderIndex('unknown')).toBe(6);
  });
});

describe('getCascadingHorizons', () => {
  it('should return 1h, 4h, daily for daily index (6)', () => {
    const horizons = getCascadingHorizons(6);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '1h', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: '4h', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: 'daily', dimension: 'momentum_long' });
  });

  it('should return 4h, daily, weekly for weekly index (7)', () => {
    const horizons = getCascadingHorizons(7);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '4h', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: 'daily', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: 'weekly', dimension: 'momentum_long' });
  });

  it('should return daily, weekly, monthly for monthly index (8)', () => {
    const horizons = getCascadingHorizons(8);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: 'daily', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: 'weekly', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: 'monthly', dimension: 'momentum_long' });
  });

  it('should return 30m, 1h, 4h for 1h index (4)', () => {
    const horizons = getCascadingHorizons(4);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '30m', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: '1h', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: '4h', dimension: 'momentum_long' });
  });

  it('should return 1h, 4h, daily for 4h index (5)', () => {
    const horizons = getCascadingHorizons(5);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '1h', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: '4h', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: 'daily', dimension: 'momentum_long' });
  });

  it('should return 5m, 15m, 30m for 15m index (2)', () => {
    const horizons = getCascadingHorizons(2);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '5m', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: '15m', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: '30m', dimension: 'momentum_long' });
  });

  it('should return 1m, 5m, 15m for 5m index (1)', () => {
    const horizons = getCascadingHorizons(1);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '1m', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: '5m', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: '15m', dimension: 'momentum_long' });
  });

  it('should return 1m, 1m, 5m for 1m index (0) - edge case', () => {
    const horizons = getCascadingHorizons(0);
    expect(horizons).toHaveLength(3);
    expect(horizons[0]).toEqual({ timeframeHint: '1m', dimension: 'momentum_short' });
    expect(horizons[1]).toEqual({ timeframeHint: '1m', dimension: 'momentum_medium' });
    expect(horizons[2]).toEqual({ timeframeHint: '5m', dimension: 'momentum_long' });
  });
});

describe('getPrimaryHorizonIndex', () => {
  it('should return 2 for daily and above (requested = largest horizon)', () => {
    expect(getPrimaryHorizonIndex(6)).toBe(2); // daily
    expect(getPrimaryHorizonIndex(7)).toBe(2); // weekly
    expect(getPrimaryHorizonIndex(8)).toBe(2); // monthly
  });

  it('should return 1 for intraday (requested = middle horizon)', () => {
    expect(getPrimaryHorizonIndex(0)).toBe(1);
    expect(getPrimaryHorizonIndex(1)).toBe(1); // 5m
    expect(getPrimaryHorizonIndex(4)).toBe(1); // 1h
    expect(getPrimaryHorizonIndex(5)).toBe(1); // 4h
  });
});

describe('PriceActionSentimentProvider', () => {
  let provider: PriceActionSentimentProvider;
  const mockGetContext = marketContextService.getContext as jest.MockedFunction<
    typeof marketContextService.getContext
  >;

  beforeEach(() => {
    provider = new PriceActionSentimentProvider();
    jest.clearAllMocks();
  });

  describe('supports', () => {
    it('should support major asset classes', () => {
      expect(provider.supports('FX')).toBe(true);
      expect(provider.supports('CRYPTO')).toBe(true);
      expect(provider.supports('EQUITY')).toBe(true);
      expect(provider.supports('INDEX')).toBe(true);
      expect(provider.supports('FUTURES')).toBe(true);
    });

    it('should not support OTHER asset class', () => {
      expect(provider.supports('OTHER')).toBe(false);
    });
  });

  describe('fetchSignals', () => {
    it('should return empty array when no market context is available from any horizon', async () => {
      mockGetContext.mockResolvedValue({
        contextAvailable: false,
        reason: 'NO_SYMBOL',
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should return empty array when no price snapshot is available from any horizon', async () => {
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          dataQuality: { isFresh: true, source: 'test' },
          // No priceSnapshot
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should return 3 signals with distinct dimensions when all horizons return data', async () => {
      const now = Date.now();
      const withSnapshot = {
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          priceSnapshot: {
            last: 150,
            open: 100,
            close: 150,
            changePct: 50,
            timestamp: now,
          },
          dataQuality: { isFresh: true, source: 'test' },
        },
      };
      mockGetContext.mockResolvedValue(withSnapshot);

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toHaveLength(3);
      const dimensions = signals.map((s) => s.dimension).sort();
      expect(dimensions).toEqual(['momentum_long', 'momentum_medium', 'momentum_short']);
      // With no timeframeHint, default is daily → primary is index 2 (momentum_long)
      const momentumLong = signals.find((s) => s.dimension === 'momentum_long');
      const contextSignals = signals.filter((s) => s.dimension !== 'momentum_long');
      expect(momentumLong?.weight).toBe(1.0);
      contextSignals.forEach((s) => expect(s.weight).toBe(0.25));
      signals.forEach((s) => {
        expect(s.source).toBe('price_action');
        expect(s.score).toBeGreaterThanOrEqual(-1);
        expect(s.score).toBeLessThanOrEqual(1);
        expect([0.25, 1.0]).toContain(s.weight);
        expect(s.label).toBe('price_momentum');
      });
    });

    it('should return 1 signal when only one getContext returns price snapshot', async () => {
      const now = Date.now();
      mockGetContext
        .mockResolvedValueOnce({
          contextAvailable: true,
          context: {
            instrument: { symbol: 'AAPL', assetClass: EQUITY },
            priceSnapshot: {
              last: 110,
              open: 100,
              close: 110,
              changePct: 10,
              timestamp: now,
            },
            dataQuality: { isFresh: true, source: 'test' },
          },
        })
        .mockResolvedValueOnce({ contextAvailable: false })
        .mockResolvedValueOnce({ contextAvailable: false });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toHaveLength(1);
      expect(signals[0].source).toBe('price_action');
      expect(signals[0].dimension).toBe('momentum_short');
      expect(signals[0].score).toBeGreaterThan(0);
    });

    it('should generate negative scores for negative returns across horizons', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          priceSnapshot: {
            last: 50,
            open: 100,
            close: 50,
            changePct: -50,
            timestamp: now,
          },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals.length).toBeGreaterThanOrEqual(1);
      signals.forEach((s) => {
        expect(s.score).toBeLessThanOrEqual(0);
        expect(s.score).toBeGreaterThanOrEqual(-1);
      });
    });

    it('should generate neutral scores for flat returns', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          priceSnapshot: {
            last: 100,
            open: 100,
            close: 100,
            changePct: 0,
            timestamp: now,
          },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals.length).toBeGreaterThanOrEqual(1);
      signals.forEach((s) => expect(Math.abs(s.score)).toBeLessThan(0.1));
    });

    it('should handle errors gracefully and return empty array', async () => {
      mockGetContext.mockRejectedValue(new Error('Network error'));

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should call getContext with cascading horizons for timeframeHint daily', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          priceSnapshot: { last: 100, open: 100, timestamp: now },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 1440,
        timeframeHint: 'daily',
      });

      expect(mockGetContext).toHaveBeenCalledTimes(3);
      expect(mockGetContext.mock.calls[0][0].timeframeHint).toBe('1h');
      expect(mockGetContext.mock.calls[1][0].timeframeHint).toBe('4h');
      expect(mockGetContext.mock.calls[2][0].timeframeHint).toBe('daily');
    });

    it('should call getContext with cascading horizons for timeframeHint monthly', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'EURUSD', assetClass: 'FX' as AssetClass },
          priceSnapshot: { last: 1.1, open: 1.0, timestamp: now },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      await provider.fetchSignals({
        symbol: 'EURUSD',
        assetClass: 'FX',
        windowMinutes: 43200,
        timeframeHint: 'monthly',
      });

      expect(mockGetContext).toHaveBeenCalledTimes(3);
      expect(mockGetContext.mock.calls[0][0].timeframeHint).toBe('daily');
      expect(mockGetContext.mock.calls[1][0].timeframeHint).toBe('weekly');
      expect(mockGetContext.mock.calls[2][0].timeframeHint).toBe('monthly');
    });

    it('should call getContext with 1h, 4h, daily when timeframeHint is undefined', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          priceSnapshot: { last: 100, timestamp: now },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(mockGetContext).toHaveBeenCalledTimes(3);
      expect(mockGetContext.mock.calls[0][0].timeframeHint).toBe('1h');
      expect(mockGetContext.mock.calls[1][0].timeframeHint).toBe('4h');
      expect(mockGetContext.mock.calls[2][0].timeframeHint).toBe('daily');
    });

    it('should give primary horizon weight 1.0 and context horizons 0.25 for monthly request', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'EURUSD', assetClass: 'FX' as AssetClass },
          priceSnapshot: { last: 1.1, open: 1.0, changePct: 10, timestamp: now },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'EURUSD',
        assetClass: 'FX',
        windowMinutes: 43200,
        timeframeHint: 'monthly',
      });

      expect(signals).toHaveLength(3);
      const momentumLong = signals.find((s) => s.dimension === 'momentum_long');
      expect(momentumLong?.weight).toBe(1.0);
      signals.filter((s) => s.dimension !== 'momentum_long').forEach((s) => expect(s.weight).toBe(0.25));
    });

    it('should give primary horizon weight 1.0 for 1h request (middle horizon)', async () => {
      const now = Date.now();
      mockGetContext.mockResolvedValue({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'AAPL', assetClass: EQUITY },
          priceSnapshot: { last: 150, open: 100, timestamp: now },
          dataQuality: { isFresh: true, source: 'test' },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 60,
        timeframeHint: '1h',
      });

      expect(signals).toHaveLength(3);
      const momentumMedium = signals.find((s) => s.dimension === 'momentum_medium');
      expect(momentumMedium?.weight).toBe(1.0);
      signals.filter((s) => s.dimension !== 'momentum_medium').forEach((s) => expect(s.weight).toBe(0.25));
    });
  });
});
