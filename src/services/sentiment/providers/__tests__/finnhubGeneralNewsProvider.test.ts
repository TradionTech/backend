/**
 * Unit tests for FinnhubGeneralNewsProvider.
 */

import { FinnhubGeneralNewsProvider } from '../finnhubGeneralNewsProvider';
import type { AssetClass } from '../../../../types/market';

jest.mock('../finnhubClient', () => ({
  createFinnhubClient: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

const { createFinnhubClient } = require('../finnhubClient');

describe('FinnhubGeneralNewsProvider', () => {
  let provider: FinnhubGeneralNewsProvider;
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createFinnhubClient as jest.Mock).mockReturnValue({ get: mockGet });
    provider = new FinnhubGeneralNewsProvider();
  });

  describe('supports', () => {
    it('should support FX, CRYPTO, and EQUITY', () => {
      expect(provider.supports('FX')).toBe(true);
      expect(provider.supports('CRYPTO')).toBe(true);
      expect(provider.supports('EQUITY')).toBe(true);
    });
  });

  describe('fetchSignals', () => {
    it('should call market news for FX and filter by symbol', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockGet.mockResolvedValue({
        data: [
          {
            id: 1,
            headline: 'EURUSD RALLY continues',
            summary: 'Forex gains',
            datetime: now,
          },
          {
            id: 2,
            headline: 'USD CRASH fears',
            summary: 'Bearish',
            datetime: now - 3600,
          },
        ],
      });

      const signals = await provider.fetchSignals({
        symbol: 'EURUSD',
        assetClass: 'FX',
        windowMinutes: 240,
      });

      expect(mockGet).toHaveBeenCalledWith(
        '/news',
        expect.objectContaining({ params: expect.objectContaining({ category: 'forex' }) })
      );
      expect(signals.length).toBeGreaterThanOrEqual(1);
      expect(signals.length).toBeLessThanOrEqual(10);
      signals.forEach((s) => {
        expect(s.source).toBe('finnhub_general_news');
        expect(s.dimension).toBe('headline_category_lexicon');
        expect(s.score).toBeGreaterThanOrEqual(-1);
        expect(s.score).toBeLessThanOrEqual(1);
        expect(s.weight).toBeGreaterThan(0);
      });
    });

    it('should call company-news for EQUITY with from/to dates', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockGet.mockResolvedValue({
        data: [
          {
            id: 1,
            headline: 'AAPL RALLY on earnings',
            summary: 'Gains',
            datetime: now,
          },
        ],
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 60,
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
      expect(signals.length).toBeGreaterThanOrEqual(0);
      signals.forEach((s) => {
        expect(s.source).toBe('finnhub_general_news');
        expect(s.symbol).toBe('AAPL');
      });
    });

    it('should return empty array on API error', async () => {
      mockGet.mockRejectedValue(new Error('Timeout'));

      const signals = await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });
  });
});
