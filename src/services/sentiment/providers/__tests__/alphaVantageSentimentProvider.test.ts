/**
 * Unit tests for AlphaVantageNewsSentimentProvider.
 */

import axios from 'axios';
import { AlphaVantageNewsSentimentProvider } from '../alphaVantageSentimentProvider';
import type { AssetClass } from '../../../../types/market';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AlphaVantageNewsSentimentProvider', () => {
  let provider: AlphaVantageNewsSentimentProvider;
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      get: mockGet,
    } as any);
    provider = new AlphaVantageNewsSentimentProvider('test-api-key');
  });

  describe('supports', () => {
    it('should support EQUITY asset class', () => {
      expect(provider.supports('EQUITY')).toBe(true);
    });

    it('should support CRYPTO asset class', () => {
      expect(provider.supports('CRYPTO')).toBe(true);
    });

    it('should support FX asset class', () => {
      expect(provider.supports('FX')).toBe(true);
    });

    it('should not support OTHER asset class', () => {
      expect(provider.supports('OTHER')).toBe(false);
    });
  });

  describe('fetchSignals', () => {
    it('should return empty array when API key is not configured', async () => {
      const providerWithoutKey = new AlphaVantageNewsSentimentProvider('');
      const signals = await providerWithoutKey.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });
      expect(signals).toEqual([]);
    });

    it('should return empty array for unsupported asset class', async () => {
      const signals = await provider.fetchSignals({
        symbol: 'XYZ',
        assetClass: 'OTHER',
        windowMinutes: 240,
      });
      expect(signals).toEqual([]);
    });

    it('should map symbols correctly for CRYPTO', async () => {
      mockGet.mockResolvedValue({
        data: {
          feed: [],
        },
      });

      await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(mockGet).toHaveBeenCalled();
      const callArgs = mockGet.mock.calls[0];
      expect(callArgs[1].params.tickers).toBe('CRYPTO:BTC,FOREX:USD');
    });

    it('should map FX symbols correctly and request NEWS_SENTIMENT', async () => {
      mockGet.mockResolvedValue({
        data: { feed: [] },
      });

      await provider.fetchSignals({
        symbol: 'EURUSD',
        assetClass: 'FX',
        windowMinutes: 240,
      });

      expect(mockGet).toHaveBeenCalledWith('', expect.objectContaining({
        params: expect.objectContaining({
          function: 'NEWS_SENTIMENT',
          tickers: 'FOREX:EUR,FOREX:USD',
        }),
      }));
    });

    it('should normalize FX symbol with separator (EUR/USD) to EURUSD', async () => {
      mockGet.mockResolvedValue({ data: { feed: [] } });

      await provider.fetchSignals({
        symbol: 'EUR/USD',
        assetClass: 'FX',
        windowMinutes: 240,
      });

      expect(mockGet).toHaveBeenCalled();
      const callArgs = mockGet.mock.calls[0];
      expect(callArgs[1].params.tickers).toBe('FOREX:EUR,FOREX:USD');
    });

    it('should parse FX news and match ticker_sentiment (EUR or USD)', async () => {
      const now = new Date();
      const ts = now.toISOString().replace(/[-:]/g, '').split('.')[0];

      mockGet.mockResolvedValue({
        data: {
          feed: [
            {
              title: 'FX Article',
              url: 'https://example.com/fx',
              time_published: ts,
              overall_sentiment_score: 0.2,
              ticker_sentiment: [
                { ticker: 'FOREX:EUR', ticker_sentiment_score: -0.3, relevance_score: 0.9 },
              ],
            },
          ],
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'EURUSD',
        assetClass: 'FX',
        windowMinutes: 240,
      });

      expect(signals.length).toBe(1);
      expect(signals[0].source).toBe('alpha_vantage_news');
      expect(signals[0].symbol).toBe('EURUSD');
      expect(signals[0].score).toBe(-0.3);
    });

    it('should parse news articles and extract sentiment scores', async () => {
      const now = new Date();
      const timestampStr = now.toISOString().replace(/[-:]/g, '').split('.')[0]; // Format: 20240101T120000

      mockGet.mockResolvedValue({
        data: {
          feed: [
            {
              title: 'Test Article',
              url: 'https://example.com/article',
              time_published: timestampStr,
              overall_sentiment_score: 0.5,
              ticker_sentiment: [
                {
                  ticker: 'AAPL',
                  ticker_sentiment_score: 0.6,
                  relevance_score: 0.8,
                },
              ],
            },
          ],
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0].source).toBe('alpha_vantage_news');
      expect(signals[0].score).toBe(0.6); // Uses ticker-specific score
      expect(signals[0].weight).toBe(1.0);
      expect(signals[0].label).toBe('news_headline');
    });

    it('should handle API errors gracefully', async () => {
      mockGet.mockResolvedValue({
        data: {
          'Error Message': 'Invalid API call',
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should handle rate limit errors gracefully', async () => {
      mockGet.mockResolvedValue({
        data: {
          Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute...',
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should filter articles by time window', async () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5 hours ago
      const oldTimestampStr = oldTimestamp.toISOString().replace(/[-:]/g, '').split('.')[0];
      const recentTimestamp = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago
      const recentTimestampStr = recentTimestamp.toISOString().replace(/[-:]/g, '').split('.')[0];

      mockGet.mockResolvedValue({
        data: {
          feed: [
            {
              title: 'Old Article',
              time_published: oldTimestampStr,
              overall_sentiment_score: 0.5,
              ticker_sentiment: [{ ticker: 'AAPL', ticker_sentiment_score: 0.5 }],
            },
            {
              title: 'Recent Article',
              time_published: recentTimestampStr,
              overall_sentiment_score: 0.6,
              ticker_sentiment: [{ ticker: 'AAPL', ticker_sentiment_score: 0.6 }],
            },
          ],
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240, // 4 hours window
      });

      // Should only include the recent article (within 4 hour window)
      expect(signals.length).toBe(1);
      expect(signals[0].score).toBe(0.6);
    });
  });
});
