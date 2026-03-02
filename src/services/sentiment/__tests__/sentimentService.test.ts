/**
 * Unit tests for SentimentService.
 * Tests sentiment context building with various scenarios.
 */

import { SentimentService } from '../sentimentService';
import { SentimentScore } from '../../../db/models/SentimentScore';
import type { SentimentSnapshotRequest, RawSentimentSignal } from '../sentimentTypes';
import { getDefaultSentimentProviders } from '../sentimentProvider';
import { marketContextService } from '../../market/marketContextService';

// Mock dependencies
jest.mock('../../../db/models/SentimentScore');
jest.mock('../../market/marketContextService', () => ({
  marketContextService: {
    getContext: jest.fn().mockResolvedValue({
      contextAvailable: false,
      reason: 'NO_SYMBOL',
    }),
  },
}));

// Mock providers - create provider instances that can be accessed in tests
const mockPriceActionProvider = {
  name: 'price_action',
  supports: jest.fn((assetClass: string) => ['FX', 'CRYPTO', 'EQUITY', 'INDEX', 'FUTURES'].includes(assetClass)),
  fetchSignals: jest.fn(),
};

const mockAlphaVantageProvider = {
  name: 'alpha_vantage_news',
  supports: jest.fn((assetClass: string) => assetClass === 'EQUITY' || assetClass === 'CRYPTO'),
  fetchSignals: jest.fn(),
};

const mockCryptoFearGreedProvider = {
  name: 'crypto_fear_greed',
  supports: jest.fn((assetClass: string) => assetClass === 'CRYPTO'),
  fetchSignals: jest.fn(),
};

jest.mock('../sentimentProvider', () => {
  return {
    getDefaultSentimentProviders: jest.fn(() => [
      mockPriceActionProvider,
      mockAlphaVantageProvider,
      mockCryptoFearGreedProvider,
    ]),
    getProvidersForAssetClass: jest.fn((providers: any[], assetClass: string) =>
      providers.filter((p) => p.supports(assetClass))
    ),
  };
});

describe('SentimentService', () => {
  let service: SentimentService;
  const mockFindAll = SentimentScore.findAll as jest.MockedFunction<typeof SentimentScore.findAll>;
  const mockGetContext = marketContextService.getContext as jest.MockedFunction<
    typeof marketContextService.getContext
  >;
  const mockGetDefaultProviders = getDefaultSentimentProviders as jest.MockedFunction<
    typeof getDefaultSentimentProviders
  >;

  beforeEach(() => {
    service = new SentimentService();
    jest.clearAllMocks();

    // Default mock: no market context
    mockGetContext.mockResolvedValue({
      contextAvailable: false,
      reason: 'NO_SYMBOL',
    });

    // Default mock: providers return empty arrays
    const providers = mockGetDefaultProviders();
    providers.forEach((provider: any) => {
      provider.fetchSignals.mockResolvedValue([]);
    });
  });

  describe('buildSentimentContext', () => {
    it('should handle no signals scenario', async () => {
      mockFindAll.mockResolvedValue([]);

      const request: SentimentSnapshotRequest = {
        symbol: 'AAPL',
        windowMinutes: 240,
      };

      const context = await service.buildSentimentContext(request);

      expect(context.symbol).toBe('AAPL');
      expect(context.aggregate).toBeNull();
      expect(context.drivers).toHaveLength(0);
      expect(context.dataQuality.hasEnoughSignals).toBe(false);
      expect(context.dataQuality.signalsAvailable).toBe(0);
      expect(context.dataQuality.issues).toContain('NO_SIGNALS');
    });

    it('should build context with multiple signals', async () => {
      const now = new Date();
      mockFindAll.mockResolvedValue([
        {
          id: '1',
          symbol: 'AAPL',
          score: 75,
          trend: 'bullish',
          drivers: { source: 'news', label: 'earnings' },
          timestamp: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
          userId: null,
        } as any,
        {
          id: '2',
          symbol: 'AAPL',
          score: 65,
          trend: 'bullish',
          drivers: { source: 'social', label: 'earnings' },
          timestamp: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
          userId: null,
        } as any,
        {
          id: '3',
          symbol: 'AAPL',
          score: 45,
          trend: 'neutral',
          drivers: { source: 'research' },
          timestamp: new Date(now.getTime() - 15 * 60 * 1000), // 15 min ago
          userId: null,
        } as any,
      ]);

      const request: SentimentSnapshotRequest = {
        symbol: 'AAPL',
        windowMinutes: 240,
      };

      const context = await service.buildSentimentContext(request);

      expect(context.symbol).toBe('AAPL');
      expect(context.aggregate).not.toBeNull();
      expect(context.aggregate!.signalsUsed).toBe(3);
      expect(context.drivers.length).toBeGreaterThan(0);
      expect(context.rawStats.bySource.length).toBeGreaterThan(0);
      expect(context.dataQuality.signalsAvailable).toBe(3);
    });

    it('should use custom windowMinutes when provided', async () => {
      mockFindAll.mockResolvedValue([]);

      const request: SentimentSnapshotRequest = {
        symbol: 'AAPL',
        windowMinutes: 1440, // 24 hours
      };

      const context = await service.buildSentimentContext(request);

      expect(context.windowDescription).toMatch(/1 day|24/);
      expect(context.dataQuality.windowMinutes).toBe(1440);
    });

    it('should detect stale data when latest signal is old', async () => {
      const now = new Date();
      mockFindAll.mockResolvedValue([
        {
          id: '1',
          symbol: 'AAPL',
          score: 50,
          trend: 'neutral',
          drivers: null,
          timestamp: new Date(now.getTime() - 5 * 60 * 60 * 1000), // 5 hours ago
          userId: null,
        } as any,
      ]);

      const request: SentimentSnapshotRequest = {
        symbol: 'AAPL',
        windowMinutes: 240, // 4 hours
      };

      const context = await service.buildSentimentContext(request);

      expect(context.dataQuality.isFresh).toBe(false);
      expect(context.dataQuality.issues).toContain('STALE_DATA');
    });

    it('should detect low signal count', async () => {
      const now = new Date();
      mockFindAll.mockResolvedValue([
        {
          id: '1',
          symbol: 'AAPL',
          score: 50,
          trend: 'neutral',
          drivers: null,
          timestamp: now,
          userId: null,
        } as any,
      ]);

      const request: SentimentSnapshotRequest = {
        symbol: 'AAPL',
        windowMinutes: 240,
      };

      const context = await service.buildSentimentContext(request);

      expect(context.dataQuality.hasEnoughSignals).toBe(false);
      expect(context.dataQuality.issues).toContain('LOW_SIGNAL_COUNT');
    });

    // Provider integration tests
    describe('Provider Integration', () => {
      it('should handle case A: No providers return signals → NO_SIGNALS', async () => {
        mockFindAll.mockResolvedValue([]);
        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
            },
            dataQuality: {
              isFresh: true,
              source: 'test',
            },
          },
        });

        const providers = mockGetDefaultProviders();
        providers.forEach((provider: any) => {
          provider.fetchSignals.mockResolvedValue([]);
        });

        const request: SentimentSnapshotRequest = {
          symbol: 'AAPL',
          windowMinutes: 240,
        };

        const context = await service.buildSentimentContext(request);

        expect(context.aggregate).toBeNull();
        expect(context.dataQuality.hasEnoughSignals).toBe(false);
        expect(context.dataQuality.issues).toContain('NO_SIGNALS');
      });

      it('should handle case B: Only PriceActionSentimentProvider returns signals → PRICE_ONLY flag', async () => {
        mockFindAll.mockResolvedValue([]);
        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
            },
            dataQuality: {
              isFresh: true,
              source: 'test',
            },
          },
        });

        // Price action provider returns a signal
        const mockSignal: RawSentimentSignal = {
          id: 'price-1',
          symbol: 'AAPL',
          source: 'price_action',
          score: 0.5,
          scaleMin: -1,
          scaleMax: 1,
          weight: 0.5,
          timestamp: new Date(),
          label: 'price_momentum',
        };
        mockPriceActionProvider.fetchSignals.mockResolvedValue([mockSignal]);

        // Alpha Vantage returns empty
        mockAlphaVantageProvider.fetchSignals.mockResolvedValue([]);

        const request: SentimentSnapshotRequest = {
          symbol: 'AAPL',
          windowMinutes: 240,
        };

        const context = await service.buildSentimentContext(request);

        expect(context.aggregate).not.toBeNull();
        expect(context.rawStats.bySource.some((s) => s.source === 'price_action')).toBe(true);
        expect(context.dataQuality.issues).toContain('PRICE_ONLY');
        expect(context.dataQuality.issues).toContain('SINGLE_SOURCE');
      });

      it('should handle case C: AlphaVantageSentimentProvider returns news signals', async () => {
        mockFindAll.mockResolvedValue([]);
        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
            },
            dataQuality: {
              isFresh: true,
              source: 'test',
            },
          },
        });

        const mockSignals: RawSentimentSignal[] = [
          {
            id: 'news-1',
            symbol: 'AAPL',
            source: 'alpha_vantage_news',
            score: 0.3,
            scaleMin: -1,
            scaleMax: 1,
            weight: 1.0,
            timestamp: new Date(),
            label: 'news_headline',
          },
          {
            id: 'news-2',
            symbol: 'AAPL',
            source: 'alpha_vantage_news',
            score: 0.5,
            scaleMin: -1,
            scaleMax: 1,
            weight: 1.0,
            timestamp: new Date(),
            label: 'news_headline',
          },
        ];
        mockAlphaVantageProvider.fetchSignals.mockResolvedValue(mockSignals);

        const request: SentimentSnapshotRequest = {
          symbol: 'AAPL',
          windowMinutes: 240,
        };

        const context = await service.buildSentimentContext(request);

        expect(context.aggregate).not.toBeNull();
        expect(context.aggregate!.direction).toBeDefined();
        expect(context.rawStats.bySource.some((s) => s.source === 'alpha_vantage_news')).toBe(true);
        expect(context.aggregate!.sourcesUsed).toContain('alpha_vantage_news');
      });

      it('should handle case D: CryptoFearGreedProvider returns signal for BTC', async () => {
        mockFindAll.mockResolvedValue([]);
        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: {
              symbol: 'BTC/USD',
              assetClass: 'CRYPTO',
            },
            dataQuality: {
              isFresh: true,
              source: 'test',
            },
          },
        });

        const mockSignal: RawSentimentSignal = {
          id: 'fng-1',
          symbol: 'BTC/USD',
          source: 'crypto_fear_greed',
          score: 75, // Fear & Greed index (0-100 scale)
          scaleMin: 0,
          scaleMax: 100,
          weight: 1.0,
          timestamp: new Date(),
          label: 'fear_greed_index',
        };
        mockCryptoFearGreedProvider.fetchSignals.mockResolvedValue([mockSignal]);

        const request: SentimentSnapshotRequest = {
          symbol: 'BTC/USD',
          windowMinutes: 240,
        };

        const context = await service.buildSentimentContext(request);

        expect(context.aggregate).not.toBeNull();
        expect(context.aggregate!.direction).toBeDefined();
        // Index of 75 should map to bullish sentiment after normalization
        expect(context.aggregate!.sourcesUsed).toContain('crypto_fear_greed');
        expect(context.rawStats.bySource.some((s) => s.source === 'crypto_fear_greed')).toBe(true);
      });

      it('should combine provider signals with DB signals', async () => {
        const now = new Date();
        mockFindAll.mockResolvedValue([
          {
            id: 'db-1',
            symbol: 'AAPL',
            score: 60,
            trend: 'bullish',
            drivers: { source: 'aggregated' },
            timestamp: now,
            userId: null,
          } as any,
        ]);

        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
            },
            dataQuality: {
              isFresh: true,
              source: 'test',
            },
          },
        });

        const mockSignal: RawSentimentSignal = {
          id: 'price-1',
          symbol: 'AAPL',
          source: 'price_action',
          score: 0.3,
          scaleMin: -1,
          scaleMax: 1,
          weight: 0.5,
          timestamp: new Date(),
          label: 'price_momentum',
        };
        mockPriceActionProvider.fetchSignals.mockResolvedValue([mockSignal]);

        const request: SentimentSnapshotRequest = {
          symbol: 'AAPL',
          windowMinutes: 240,
        };

        const context = await service.buildSentimentContext(request);

        expect(context.aggregate).not.toBeNull();
        expect(context.aggregate!.signalsUsed).toBeGreaterThan(1);
        // Should have signals from both provider and DB
        const sources = context.rawStats.bySource.map((s) => s.source);
        expect(sources.length).toBeGreaterThan(1);
      });
    });

    describe('Data quality (per-asset-class hasEnoughSignals)', () => {
      it('should set hasEnoughSignals true when signals >= min for asset class (e.g. 7 signals, 3 sources)', async () => {
        mockFindAll.mockResolvedValue([]);
        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: { symbol: 'AAPL', assetClass: 'EQUITY' },
            dataQuality: { isFresh: true, source: 'test' },
          },
        });

        const now = new Date();
        const mk = (source: string, id: string): RawSentimentSignal => ({
          id,
          symbol: 'AAPL',
          source,
          score: 0.2,
          scaleMin: -1,
          scaleMax: 1,
          weight: 1.0,
          timestamp: now,
          label: 'test',
        });
        mockPriceActionProvider.fetchSignals.mockResolvedValue([
          mk('price_action', 'p1'),
          mk('price_action', 'p2'),
          mk('price_action', 'p3'),
        ]);
        mockAlphaVantageProvider.fetchSignals.mockResolvedValue([
          mk('alpha_vantage_news', 'a1'),
          mk('alpha_vantage_news', 'a2'),
        ]);
        mockCryptoFearGreedProvider.fetchSignals.mockResolvedValue([]);

        const context = await service.buildSentimentContext({
          symbol: 'AAPL',
          windowMinutes: 240,
        });

        expect(context.dataQuality.signalsAvailable).toBeGreaterThanOrEqual(5);
        expect(context.dataQuality.hasEnoughSignals).toBe(true);
        expect(context.dataQuality.issues).not.toContain('LOW_SIGNAL_COUNT');
      });

      it('should set hasEnoughSignals true but SINGLE_SOURCE when exactly min signals from one source', async () => {
        mockFindAll.mockResolvedValue([]);
        mockGetContext.mockResolvedValue({
          contextAvailable: true,
          context: {
            instrument: { symbol: 'AAPL', assetClass: 'EQUITY' },
            dataQuality: { isFresh: true, source: 'test' },
          },
        });

        const now = new Date();
        const fiveSignals: RawSentimentSignal[] = [1, 2, 3, 4, 5].map((i) => ({
          id: `p${i}`,
          symbol: 'AAPL',
          source: 'price_action',
          score: 0.1,
          scaleMin: -1,
          scaleMax: 1,
          weight: 0.5,
          timestamp: now,
          label: 'price_momentum',
        }));
        mockPriceActionProvider.fetchSignals.mockResolvedValue(fiveSignals);
        mockAlphaVantageProvider.fetchSignals.mockResolvedValue([]);
        mockCryptoFearGreedProvider.fetchSignals.mockResolvedValue([]);

        const context = await service.buildSentimentContext({
          symbol: 'AAPL',
          windowMinutes: 240,
        });

        expect(context.dataQuality.signalsAvailable).toBe(5);
        expect(context.dataQuality.hasEnoughSignals).toBe(true);
        expect(context.dataQuality.issues).toContain('SINGLE_SOURCE');
        expect(context.dataQuality.issues).not.toContain('LOW_SIGNAL_COUNT');
      });
    });
  });
});
