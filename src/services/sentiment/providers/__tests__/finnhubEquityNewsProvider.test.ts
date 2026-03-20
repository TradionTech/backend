/**
 * Unit tests for FinnhubEquityNewsSentimentProvider.
 */

import { FinnhubEquityNewsSentimentProvider } from '../finnhubEquityNewsProvider';

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
    it('should return article-based signals from company-news endpoint', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockGet.mockResolvedValue({
        data: [
          {
            id: 1,
            headline: 'AAPL RALLY after earnings BEAT',
            summary: 'Analysts upgrade growth outlook',
            datetime: now,
            url: 'https://example.com/aapl-news',
          },
        ],
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(mockGet).toHaveBeenCalledWith(
        '/company-news',
        expect.objectContaining({
          params: expect.objectContaining({
            symbol: 'AAPL',
            from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          }),
        })
      );
      expect(signals.length).toBeGreaterThanOrEqual(1);
      expect(signals.every((s) => s.source === 'finnhub_equity_news')).toBe(true);
      expect(signals.every((s) => s.symbol === 'AAPL')).toBe(true);
      const dimensions = signals.map((s) => s.dimension);
      expect(dimensions).toContain('company_news_lexicon');
      signals.forEach((s) => {
        expect(s.score).toBeGreaterThanOrEqual(-1);
        expect(s.score).toBeLessThanOrEqual(1);
        expect(s.weight).toBeGreaterThan(0);
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
