import {
  computeWinRate,
  computeAvgRr,
  computeAvgPnlUsd,
  computeMedianRiskPerTradePct,
  computeMaxDrawdownPct,
  bucketTrades,
  detectBehaviourPatterns,
} from '../journalAnalytics.js';
import type { AnalyzableTrade } from '../journalTypes.js';
import type { UserProfileMetrics } from '../../profile/profileTypes.js';

describe('journalAnalytics', () => {
  describe('computeWinRate', () => {
    it('should compute win rate correctly', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
        },
        {
          id: '2',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.05,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: -50,
        },
        {
          id: '3',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.15,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 50,
        },
      ];

      const winRate = computeWinRate(trades);
      expect(winRate).toBeCloseTo(66.67, 1);
    });

    it('should return null for empty array', () => {
      expect(computeWinRate([])).toBeNull();
    });
  });

  describe('computeAvgRr', () => {
    it('should compute average RR correctly', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          stopPrice: 1.05,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
          realizedRr: 2.0,
        },
        {
          id: '2',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.15,
          stopPrice: 1.05,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 50,
          realizedRr: 1.0,
        },
      ];

      const avgRr = computeAvgRr(trades);
      expect(avgRr).toBeCloseTo(1.5, 2);
    });

    it('should return null when no valid RR data', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
          realizedRr: null,
        },
      ];

      expect(computeAvgRr(trades)).toBeNull();
    });
  });

  describe('computeAvgPnlUsd', () => {
    it('should compute average PnL correctly', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
        },
        {
          id: '2',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.05,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: -50,
        },
      ];

      const avgPnl = computeAvgPnlUsd(trades);
      expect(avgPnl).toBe(25);
    });

    it('should return null for empty array', () => {
      expect(computeAvgPnlUsd([])).toBeNull();
    });
  });

  describe('computeMaxDrawdownPct', () => {
    it('should compute max drawdown correctly', () => {
      const baseDate = new Date('2024-01-01');
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: baseDate,
          closedAt: new Date(baseDate.getTime() + 1000),
          realizedPnlUsd: 100,
          equityAtOpenUsd: 1000,
        },
        {
          id: '2',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.05,
          quantity: 1,
          openedAt: new Date(baseDate.getTime() + 2000),
          closedAt: new Date(baseDate.getTime() + 3000),
          realizedPnlUsd: -200,
          equityAtOpenUsd: 1100,
        },
        {
          id: '3',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.15,
          quantity: 1,
          openedAt: new Date(baseDate.getTime() + 4000),
          closedAt: new Date(baseDate.getTime() + 5000),
          realizedPnlUsd: 50,
          equityAtOpenUsd: 900,
        },
      ];

      const drawdown = computeMaxDrawdownPct(trades);
      expect(drawdown).toBeGreaterThan(0);
    });

    it('should return null for insufficient trades', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
        },
      ];

      expect(computeMaxDrawdownPct(trades)).toBeNull();
    });
  });

  describe('bucketTrades', () => {
    it('should bucket trades by symbol', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
        },
        {
          id: '2',
          userId: 'u1',
          symbol: 'GBPUSD',
          side: 'long',
          entryPrice: 1.25,
          exitPrice: 1.3,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 50,
        },
        {
          id: '3',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.15,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 50,
        },
      ];

      const buckets = bucketTrades(trades, (t) => ({ symbol: t.symbol }));
      expect(buckets.length).toBe(2);
      expect(buckets.find((b) => b.key.symbol === 'EURUSD')?.tradeCount).toBe(2);
      expect(buckets.find((b) => b.key.symbol === 'GBPUSD')?.tradeCount).toBe(1);
    });
  });

  describe('detectBehaviourPatterns', () => {
    it('should detect size inconsistency pattern', () => {
      const profileMetrics: UserProfileMetrics = {
        userId: 'u1',
        typicalRiskPerTradePct: 1.0,
        typicalPositionSizeUsd: 100,
        avgRrRatio: 2.0,
        maxDrawdownPct: 10,
        lastComputedAt: new Date(),
      };

      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
        },
        {
          id: '2',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 10,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 1000,
        },
        {
          id: '3',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 0.1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 10,
        },
        {
          id: '4',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 5,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 500,
        },
        {
          id: '5',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 0.5,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 50,
        },
      ];

      const patterns = detectBehaviourPatterns(trades, profileMetrics);
      const sizeInconsistency = patterns.find((p) => p.type === 'size_inconsistency');
      expect(sizeInconsistency).toBeDefined();
    });

    it('should return empty array for insufficient trades', () => {
      const trades: AnalyzableTrade[] = [
        {
          id: '1',
          userId: 'u1',
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1,
          exitPrice: 1.2,
          quantity: 1,
          openedAt: new Date(),
          closedAt: new Date(),
          realizedPnlUsd: 100,
        },
      ];

      const patterns = detectBehaviourPatterns(trades, null);
      expect(patterns).toEqual([]);
    });
  });
});
