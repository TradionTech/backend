import { MarketContextService } from '../marketContextService';
import { DummyMarketDataProvider } from '../providers/dummyMarketDataProvider';
import type { RawMarketData, MarketContextRequest } from '../../../types/market';

describe('MarketContextService', () => {
  let service: MarketContextService;
  let mockProvider: jest.Mocked<DummyMarketDataProvider>;

  beforeEach(() => {
    // Create a mock provider
    mockProvider = {
      getSnapshot: jest.fn(),
    } as any;

    // Create a fresh service instance for each test
    service = new MarketContextService();
    
    // Replace the provider with our mock
    (service as any).provider = mockProvider;
  });

  describe('getContext', () => {
    it('should return context when symbol is provided', async () => {
      const mockRawData: RawMarketData = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        candles: [
          { timestamp: Date.now() - 5000000, open: 1.096, high: 1.101, low: 1.094, close: 1.099 },
          { timestamp: Date.now() - 4000000, open: 1.099, high: 1.104, low: 1.098, close: 1.101 },
          { timestamp: Date.now() - 3600000, open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1020 },
          { timestamp: Date.now() - 1800000, open: 1.1020, high: 1.1070, low: 1.1010, close: 1.1040 },
          { timestamp: Date.now(), open: 1.1040, high: 1.1080, low: 1.1030, close: 1.1060 },
        ],
        lastPrice: 1.1060,
        timestamp: Date.now(),
        provider: 'dummy',
        base: 'EUR',
        quote: 'USD',
      };

      mockProvider.getSnapshot.mockResolvedValue(mockRawData);

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };

      const result = await service.getContext(request);

      expect(result.contextAvailable).toBe(true);
      expect(result.context).toBeDefined();
      expect(result.context?.instrument.symbol).toBe('EURUSD');
      expect(result.context?.instrument.assetClass).toBe('FX');
      expect(result.context?.priceSnapshot).toBeDefined();
      expect(result.context?.trendSignals).toBeDefined();
      expect(result.context?.volatilitySignals).toBeDefined();
      expect(result.context?.dataQuality).toBeDefined();
    });

    it('should return NO_SYMBOL when symbol is missing', async () => {
      const request: MarketContextRequest = {
        rawQuery: 'What is trading?',
      };

      const result = await service.getContext(request);

      expect(result.contextAvailable).toBe(false);
      expect(result.reason).toBe('NO_SYMBOL');
    });

    it('should return PROVIDER_ERROR when provider fails', async () => {
      mockProvider.getSnapshot.mockRejectedValue(new Error('Provider error'));

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
      };

      const result = await service.getContext(request);

      expect(result.contextAvailable).toBe(false);
      expect(result.reason).toBe('PROVIDER_ERROR');
      expect(result.error).toBeDefined();
    });
  });

  describe('buildContext', () => {
    it('should compute trend signals correctly', () => {
      const rawData: RawMarketData = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        candles: [
          { timestamp: Date.now() - 3600000, open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1010 },
          { timestamp: Date.now() - 2400000, open: 1.1010, high: 1.1060, low: 1.1000, close: 1.1020 },
          { timestamp: Date.now() - 1200000, open: 1.1020, high: 1.1070, low: 1.1010, close: 1.1030 },
          { timestamp: Date.now(), open: 1.1030, high: 1.1080, low: 1.1020, close: 1.1040 },
        ],
        timestamp: Date.now(),
        provider: 'dummy',
      };

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };

      const context = service.buildContext(rawData, request);

      expect(context.trendSignals).toBeDefined();
      expect(['up', 'down', 'sideways']).toContain(context.trendSignals?.trend);
      expect(['short_term', 'medium_term', 'long_term']).toContain(context.trendSignals?.basis);
    });

    it('should compute volatility signals correctly', () => {
      const rawData: RawMarketData = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        candles: [
          { timestamp: Date.now() - 5000000, open: 1.095, high: 1.1, low: 1.094, close: 1.098 },
          { timestamp: Date.now() - 4000000, open: 1.098, high: 1.103, low: 1.097, close: 1.1 },
          { timestamp: Date.now() - 3600000, open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1010 },
          { timestamp: Date.now() - 2400000, open: 1.1010, high: 1.1060, low: 1.1000, close: 1.1020 },
          { timestamp: Date.now() - 1200000, open: 1.1020, high: 1.1070, low: 1.1010, close: 1.1030 },
          { timestamp: Date.now(), open: 1.1030, high: 1.1080, low: 1.1020, close: 1.1040 },
        ],
        timestamp: Date.now(),
        provider: 'dummy',
      };

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };

      const context = service.buildContext(rawData, request);

      expect(context.volatilitySignals).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(context.volatilitySignals?.volatilityLevel);
      expect(context.volatilitySignals?.value).toBeDefined();
      expect(context.volatilitySignals?.metric).toBe('std_dev');
    });

    it('should mark data as stale when too old', () => {
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const rawData: RawMarketData = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        candles: [
          { timestamp: oldTimestamp, open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1010 },
        ],
        timestamp: oldTimestamp,
        provider: 'dummy',
      };

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        timeframeHint: '5m',
      };

      const context = service.buildContext(rawData, request);

      expect(context.dataQuality.isFresh).toBe(false);
      expect(context.dataQuality.ageSeconds).toBeDefined();
      expect(context.dataQuality.issues).toContain('stale_data');
    });

    it('should mark data as fresh when recent', () => {
      const recentTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutes ago
      const rawData: RawMarketData = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        candles: [
          { timestamp: recentTimestamp, open: 1.1000, high: 1.1050, low: 1.0950, close: 1.1010 },
        ],
        timestamp: recentTimestamp,
        provider: 'dummy',
      };

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };

      const context = service.buildContext(rawData, request);

      expect(context.dataQuality.isFresh).toBe(true);
      expect(context.dataQuality.ageSeconds).toBeUndefined();
    });

    it('should handle missing candles', () => {
      const rawData: RawMarketData = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        lastPrice: 1.1000,
        timestamp: Date.now(),
        provider: 'dummy',
      };

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };

      const context = service.buildContext(rawData, request);

      expect(context.priceSnapshot).toBeDefined();
      expect(context.priceSnapshot?.last).toBe(1.1000);
      expect(context.dataQuality.issues).toContain('missing_candles');
      expect(context.trendSignals).toBeUndefined();
      expect(context.volatilitySignals).toBeUndefined();
    });
  });
});
