import {
  computeTypicalRiskPerTradePct,
  computeTypicalPositionSizeUsd,
  computeAvgRrRatio,
  computeMaxDrawdownPct,
  computeUserProfileMetricsFromTrades,
} from '../profileAnalytics.js';
import type { AnalyzableTrade } from '../profileTypes.js';

describe('profileAnalytics', () => {
  describe('computeTypicalRiskPerTradePct', () => {
    it('should compute median risk percentage from valid trades', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.0950,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: 10000,
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          stopPrice: 1.2400,
          exitPrice: 1.2600,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
          equityAtOpenUsd: 12000,
        },
        {
          id: '3',
          userId: 'user1',
          symbol: 'USDJPY',
          side: 'short',
          entryPrice: 150.00,
          stopPrice: 151.00,
          exitPrice: 149.00,
          quantity: 1000,
          openedAt: new Date('2024-01-05'),
          closedAt: new Date('2024-01-06'),
          equityAtOpenUsd: 15000,
        },
      ];

      // Trade 1: risk = (1.1000 - 1.0950) * 10000 = 500, pct = 500/10000 * 100 = 5%
      // Trade 2: risk = (1.2500 - 1.2400) * 8000 = 800, pct = 800/12000 * 100 = 6.67%
      // Trade 3: risk = (151.00 - 150.00) * 1000 = 1000, pct = 1000/15000 * 100 = 6.67%
      // Median of [5, 6.67, 6.67] = 6.67
      const result = computeTypicalRiskPerTradePct(trades);
      expect(result).toBeCloseTo(6.67, 1);
    });

    it('should skip trades without stopPrice', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: null,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: 10000,
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          stopPrice: 1.2400,
          exitPrice: 1.2600,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
          equityAtOpenUsd: 12000,
        },
      ];

      // Only trade 2 is valid, risk = (1.2500 - 1.2400) * 8000 = 800, pct = 800/12000 * 100 = 6.67%
      const result = computeTypicalRiskPerTradePct(trades);
      expect(result).toBeCloseTo(6.67, 1);
    });

    it('should skip trades without equityAtOpenUsd', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.0950,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: null,
        },
      ];

      const result = computeTypicalRiskPerTradePct(trades);
      expect(result).toBe(0.5); // Default value
    });

    it('should return default value when no valid trades', () => {
      const trades: AnalyzableTrade[] = [];
      const result = computeTypicalRiskPerTradePct(trades);
      expect(result).toBe(0.5);
    });

    it('should handle zero equity gracefully', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.0950,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: 0,
        },
      ];

      const result = computeTypicalRiskPerTradePct(trades);
      expect(result).toBe(0.5); // Default value
    });
  });

  describe('computeTypicalPositionSizeUsd', () => {
    it('should compute median position size', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
        },
        {
          id: '3',
          userId: 'user1',
          symbol: 'USDJPY',
          side: 'short',
          entryPrice: 150.00,
          quantity: 1000,
          openedAt: new Date('2024-01-05'),
          closedAt: new Date('2024-01-06'),
        },
      ];

      // Trade 1: 1.1000 * 10000 = 11000
      // Trade 2: 1.2500 * 8000 = 10000
      // Trade 3: 150.00 * 1000 = 150000
      // Median of [10000, 11000, 150000] = 11000
      const result = computeTypicalPositionSizeUsd(trades);
      expect(result).toBe(11000);
    });

    it('should ignore outliers (median)', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
        },
        {
          id: '3',
          userId: 'user1',
          symbol: 'USDJPY',
          side: 'short',
          entryPrice: 150.00,
          quantity: 1000000, // Extreme outlier
          openedAt: new Date('2024-01-05'),
          closedAt: new Date('2024-01-06'),
        },
      ];

      // Median should ignore the outlier
      const result = computeTypicalPositionSizeUsd(trades);
      expect(result).toBe(11000); // Median of [10000, 11000, 150000000]
    });

    it('should return 0 when no trades', () => {
      const trades: AnalyzableTrade[] = [];
      const result = computeTypicalPositionSizeUsd(trades);
      expect(result).toBe(0);
    });
  });

  describe('computeAvgRrRatio', () => {
    it('should compute average risk-reward ratio', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.0950,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          stopPrice: 1.2400,
          exitPrice: 1.2600,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
        },
      ];

      // Trade 1: risk = (1.1000 - 1.0950) * 10000 = 500, reward = (1.1100 - 1.1000) * 10000 = 1000, R:R = 2.0
      // Trade 2: risk = (1.2500 - 1.2400) * 8000 = 800, reward = (1.2600 - 1.2500) * 8000 = 800, R:R = 1.0
      // Average = (2.0 + 1.0) / 2 = 1.5
      const result = computeAvgRrRatio(trades);
      expect(result).toBeCloseTo(1.5, 1);
    });

    it('should skip trades without stopPrice or exitPrice', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: null,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          stopPrice: 1.2400,
          exitPrice: 1.2600,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
        },
      ];

      // Only trade 2 is valid
      const result = computeAvgRrRatio(trades);
      expect(result).toBeCloseTo(1.0, 1);
    });

    it('should return null when no valid trades', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: null,
          exitPrice: null,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
      ];

      const result = computeAvgRrRatio(trades);
      expect(result).toBeNull();
    });

    it('should handle zero risk gracefully', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.1000, // Same as entry = zero risk
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
      ];

      const result = computeAvgRrRatio(trades);
      expect(result).toBeNull(); // Should skip zero risk trades
    });
  });

  describe('computeMaxDrawdownPct', () => {
    it('should compute maximum drawdown from equity curve', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: 10000,
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          exitPrice: 1.2400, // Loss
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
          equityAtOpenUsd: 11000,
        },
        {
          id: '3',
          userId: 'user1',
          symbol: 'USDJPY',
          side: 'long',
          entryPrice: 150.00,
          exitPrice: 152.00,
          quantity: 1000,
          openedAt: new Date('2024-01-05'),
          closedAt: new Date('2024-01-06'),
          equityAtOpenUsd: 10200,
        },
      ];

      // Trade 1: profit = (1.1100 - 1.1000) * 10000 = 1000, cumulative = 1000, peak = 1000
      // Trade 2: profit = (1.2400 - 1.2500) * 8000 = -800, cumulative = 200, peak = 1000, drawdown = 800
      // Trade 3: profit = (152.00 - 150.00) * 1000 = 2000, cumulative = 2200, peak = 2200
      // Max drawdown = 800 / 10000 * 100 = 8% (using starting equity as baseline)
      const result = computeMaxDrawdownPct(trades);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(10);
    });

    it('should handle short trades correctly', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'short',
          entryPrice: 1.1100,
          exitPrice: 1.1000, // Profit for short
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: 10000,
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'short',
          entryPrice: 1.2400,
          exitPrice: 1.2500, // Loss for short
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
          equityAtOpenUsd: 11000,
        },
      ];

      // Trade 1: profit = (1.1100 - 1.1000) * 10000 = 1000
      // Trade 2: profit = (1.2400 - 1.2500) * 8000 = -800
      const result = computeMaxDrawdownPct(trades);
      expect(result).not.toBeNull();
    });

    it('should return null for insufficient data', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
        },
      ];

      const result = computeMaxDrawdownPct(trades);
      expect(result).toBeNull(); // Need at least 2 closed trades
    });

    it('should return null when no closed trades', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: null,
        },
      ];

      const result = computeMaxDrawdownPct(trades);
      expect(result).toBeNull();
    });
  });

  describe('computeUserProfileMetricsFromTrades', () => {
    it('should compute all metrics from trades', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'user1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.0950,
          exitPrice: 1.1100,
          quantity: 10000,
          openedAt: new Date('2024-01-01'),
          closedAt: new Date('2024-01-02'),
          equityAtOpenUsd: 10000,
        },
        {
          id: '2',
          userId: 'user1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.2500,
          stopPrice: 1.2400,
          exitPrice: 1.2600,
          quantity: 8000,
          openedAt: new Date('2024-01-03'),
          closedAt: new Date('2024-01-04'),
          equityAtOpenUsd: 12000,
        },
      ];

      const result = computeUserProfileMetricsFromTrades(trades);

      expect(result).toHaveProperty('typicalRiskPerTradePct');
      expect(result).toHaveProperty('typicalPositionSizeUsd');
      expect(result).toHaveProperty('avgRrRatio');
      expect(result).toHaveProperty('maxDrawdownPct');
      expect(typeof result.typicalRiskPerTradePct).toBe('number');
      expect(typeof result.typicalPositionSizeUsd).toBe('number');
      expect(result.avgRrRatio === null || typeof result.avgRrRatio === 'number').toBe(true);
      expect(result.maxDrawdownPct === null || typeof result.maxDrawdownPct === 'number').toBe(true);
    });
  });
});
