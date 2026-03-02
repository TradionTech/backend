/**
 * Unit tests for CryptoFearGreedProvider.
 */

import axios from 'axios';
import { CryptoFearGreedProvider } from '../cryptoFearGreedProvider';
import type { AssetClass } from '../../../../types/market';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CryptoFearGreedProvider', () => {
  let provider: CryptoFearGreedProvider;
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      get: mockGet,
    } as any);
    provider = new CryptoFearGreedProvider();
  });

  describe('supports', () => {
    it('should support CRYPTO asset class', () => {
      expect(provider.supports('CRYPTO')).toBe(true);
    });

    it('should not support EQUITY asset class', () => {
      expect(provider.supports('EQUITY')).toBe(false);
    });

    it('should not support FX asset class', () => {
      expect(provider.supports('FX')).toBe(false);
    });
  });

  describe('fetchSignals', () => {
    it('should return empty array for unsupported asset class', async () => {
      const signals = await provider.fetchSignals({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        windowMinutes: 240,
      });
      expect(signals).toEqual([]);
    });

    it('should return empty array for unsupported symbol', async () => {
      const signals = await provider.fetchSignals({
        symbol: 'DOGE/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });
      expect(signals).toEqual([]);
    });

    it('should return 2-3 signals with level and regime (and optional delta)', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      mockGet.mockResolvedValue({
        data: {
          name: 'Fear and Greed Index',
          data: [
            { value: '75', value_classification: 'Extreme Greed', timestamp: timestamp.toString(), time_until_update: '12345' },
          ],
          metadata: { error: null },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals.length).toBeGreaterThanOrEqual(2);
      expect(signals.length).toBeLessThanOrEqual(3);
      signals.forEach((s) => {
        expect(s.source).toBe('crypto_fear_greed');
        expect(s.weight).toBe(1.0);
        expect(s.label).toBe('fear_greed_index');
        expect(['fg_level', 'fg_regime', 'fg_delta']).toContain(s.dimension!);
      });
      const levelSignal = signals.find((s) => s.dimension === 'fg_level');
      expect(levelSignal).toBeDefined();
      expect(levelSignal!.score).toBeCloseTo((75 - 50) / 50);
      expect(levelSignal!.scaleMin).toBe(-1);
      expect(levelSignal!.scaleMax).toBe(1);
    });

    it('should return negative level and regime for value 20 (extreme fear)', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      mockGet.mockResolvedValue({
        data: {
          name: 'Fear and Greed Index',
          data: [
            { value: '20', value_classification: 'Extreme Fear', timestamp: timestamp.toString() },
          ],
          metadata: { error: null },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'BTC',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals.length).toBeGreaterThanOrEqual(2);
      const levelSignal = signals.find((s) => s.dimension === 'fg_level');
      const regimeSignal = signals.find((s) => s.dimension === 'fg_regime');
      expect(levelSignal).toBeDefined();
      expect(levelSignal!.score).toBeCloseTo((20 - 50) / 50); // -0.6
      expect(regimeSignal).toBeDefined();
      expect(regimeSignal!.score).toBe(-1); // extreme fear
    });

    it('should handle API errors gracefully', async () => {
      mockGet.mockResolvedValue({
        data: {
          metadata: {
            error: 'API error occurred',
          },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should handle invalid index values', async () => {
      mockGet.mockResolvedValue({
        data: {
          data: [
            {
              value: 'invalid',
              value_classification: 'Unknown',
              timestamp: Math.floor(Date.now() / 1000).toString(),
            },
          ],
          metadata: {
            error: null,
          },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should handle timeout errors gracefully', async () => {
      mockGet.mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout',
      });

      const signals = await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals).toEqual([]);
    });

    it('should emit delta signal when limit=2 returns previous value', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      mockGet.mockResolvedValue({
        data: {
          data: [
            { value: '20', value_classification: 'Extreme Fear', timestamp: timestamp.toString() },
            { value: '50', value_classification: 'Neutral', timestamp: (timestamp - 86400).toString() },
          ],
          metadata: { error: null },
        },
      });

      const signals = await provider.fetchSignals({
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
        windowMinutes: 240,
      });

      expect(signals.length).toBe(3);
      const deltaSignal = signals.find((s) => s.dimension === 'fg_delta');
      expect(deltaSignal).toBeDefined();
      expect(deltaSignal!.details).toEqual({ delta: -30 });
      expect(deltaSignal!.score).toBeLessThan(0); // tanh(-30/10) < 0
    });
  });
});
