/**
 * Unit tests for FinnhubEquityNewsSentimentProvider.
 */

import axios from 'axios';
import { FinnhubEquityNewsSentimentProvider } from '../finnhubEquityNewsProvider';
import type { AssetClass } from '../../../../types/market';

jest.mock('../finnhubClient', () => ({
  createFinnhubClient: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

const { createFinnhubClient } = require('../finnhubClient');

describe('FinnhubEquityNewsSentimentProvider', () => {
  let provider: FinnhubEquityNewsSentimentProvider;
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createFinnhubClient as jest.Mock).mockReturnValue({ get: mockGet });
    provider = new FinnhubEquityNewsSentimentProvider();
  });

  describe('supports', () => {
    it('should support EQUITY only', () => {
      expect(provider.supports('EQUITY')).toBe(true);
      expect(provider.supports('FX')).toBe(false);
      expect(provider.supports('CRYPTO')).toBe(false);
    });
  });

  describe('fetchSignals', () => {
    it('should return 3-4 signals for valid news-sentiment response', async () => {
      mockGet.mockResolvedValue({
        data: {
          companyNewsScore: 0.7,
          sentiment: { bullishPercent: 0.6, bearishPercent: 0.2 },
          buzz: { buzz: 1.2, articlesInLastWeek: 10, weeklyAverage: 8 },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals.length).toBeGreaterThanOrEqual(3);
      expect(signals.length).toBeLessThanOrEqual(4);
      expect(signals.every((s) => s.source === 'finnhub_equity_news')).toBe(true);
      expect(signals.every((s) => s.symbol === 'AAPL')).toBe(true);
      const dimensions = signals.map((s) => s.dimension);
      expect(dimensions).toContain('companyNewsScore');
      expect(dimensions).toContain('bull_vs_bear');
      expect(dimensions).toContain('buzz_intensity');
      signals.forEach((s) => {
        expect(s.score).toBeGreaterThanOrEqual(-1);
        expect(s.score).toBeLessThanOrEqual(1);
      });
    });

    it('should return empty array on API error', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });
  });
});
