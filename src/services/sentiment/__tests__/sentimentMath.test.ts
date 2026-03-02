/**
 * Unit tests for sentiment math functions.
 * All functions must be pure and deterministic.
 */

import {
  normalizeSignal,
  aggregateSignals,
  computeBySourceStats,
  deriveDrivers,
} from '../sentimentMath';
import type {
  RawSentimentSignal,
  NormalizedSentimentSignal,
  SentimentSnapshotConfig,
} from '../sentimentTypes';

describe('sentimentMath', () => {
  const defaultConfig: SentimentSnapshotConfig = {
    windowMinutes: 240,
    minSignals: 5,
    neutralThreshold: 0.15,
    strongThreshold: 0.5,
  };

  describe('normalizeSignal', () => {
    it('should normalize score from 0-100 scale to -1..1', () => {
      const raw: RawSentimentSignal = {
        id: '1',
        symbol: 'AAPL',
        source: 'test',
        score: 50,
        scaleMin: 0,
        scaleMax: 100,
        weight: 1.0,
        timestamp: new Date(),
      };

      const normalized = normalizeSignal(raw);
      expect(normalized.normalizedScore).toBeCloseTo(0.0, 3); // 50 on 0-100 = 0.0 on -1..1
    });

    it('should normalize bullish score (75 on 0-100)', () => {
      const raw: RawSentimentSignal = {
        id: '1',
        symbol: 'AAPL',
        source: 'test',
        score: 75,
        scaleMin: 0,
        scaleMax: 100,
        weight: 1.0,
        timestamp: new Date(),
      };

      const normalized = normalizeSignal(raw);
      expect(normalized.normalizedScore).toBeCloseTo(0.5, 3); // 75 on 0-100 = 0.5 on -1..1
    });

    it('should normalize bearish score (25 on 0-100)', () => {
      const raw: RawSentimentSignal = {
        id: '1',
        symbol: 'AAPL',
        source: 'test',
        score: 25,
        scaleMin: 0,
        scaleMax: 100,
        weight: 1.0,
        timestamp: new Date(),
      };

      const normalized = normalizeSignal(raw);
      expect(normalized.normalizedScore).toBeCloseTo(-0.5, 3); // 25 on 0-100 = -0.5 on -1..1
    });

    it('should handle edge case: scale range is zero', () => {
      const raw: RawSentimentSignal = {
        id: '1',
        symbol: 'AAPL',
        source: 'test',
        score: 50,
        scaleMin: 50,
        scaleMax: 50,
        weight: 1.0,
        timestamp: new Date(),
      };

      const normalized = normalizeSignal(raw);
      expect(normalized.normalizedScore).toBe(0); // Should default to neutral
    });
  });

  describe('aggregateSignals', () => {
    it('should return null for empty signals', () => {
      const result = aggregateSignals([], defaultConfig);
      expect(result).toBeNull();
    });

    it('should aggregate multiple signals with weighted average', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.5,
          weight: 1.0,
          timestamp: new Date(),
        },
        {
          symbol: 'AAPL',
          source: 'social',
          normalizedScore: 0.3,
          weight: 1.0,
          timestamp: new Date(),
        },
        {
          symbol: 'AAPL',
          source: 'research',
          normalizedScore: -0.2,
          weight: 2.0, // Higher weight
          timestamp: new Date(),
        },
      ];

      const result = aggregateSignals(signals, defaultConfig);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('AAPL');
      expect(result!.score).toBeCloseTo(0.1, 2); // (0.5*1 + 0.3*1 - 0.2*2) / 4 = 0.1
      expect(result!.direction).toBe('neutral'); // |0.1| < 0.15 threshold
      expect(result!.signalsUsed).toBe(3);
      expect(result!.sourcesUsed).toHaveLength(3);
    });

    it('should classify as bullish when score > threshold', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.6,
          weight: 1.0,
          timestamp: new Date(),
        },
        {
          symbol: 'AAPL',
          source: 'social',
          normalizedScore: 0.5,
          weight: 1.0,
          timestamp: new Date(),
        },
      ];

      const result = aggregateSignals(signals, defaultConfig);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('bullish');
    });

    it('should classify as bearish when score < -threshold', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: -0.6,
          weight: 1.0,
          timestamp: new Date(),
        },
        {
          symbol: 'AAPL',
          source: 'social',
          normalizedScore: -0.5,
          weight: 1.0,
          timestamp: new Date(),
        },
      ];

      const result = aggregateSignals(signals, defaultConfig);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('bearish');
    });

    it('should calculate confidence based on signal count and source diversity', () => {
      const signals: NormalizedSentimentSignal[] = Array.from({ length: 10 }, (_, i) => ({
        symbol: 'AAPL',
        source: `source_${i % 3}`, // 3 unique sources
        normalizedScore: 0.3,
        weight: 1.0,
        timestamp: new Date(),
      }));

      const result = aggregateSignals(signals, defaultConfig);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThan(0);
      expect(result!.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('computeBySourceStats', () => {
    it('should group signals by source and compute averages', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.5,
          weight: 1.0,
          timestamp: new Date(),
        },
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.3,
          weight: 1.0,
          timestamp: new Date(),
        },
        {
          symbol: 'AAPL',
          source: 'social',
          normalizedScore: -0.2,
          weight: 1.0,
          timestamp: new Date(),
        },
      ];

      const stats = computeBySourceStats(signals);
      expect(stats).toHaveLength(2);
      expect(stats[0].source).toBe('news');
      expect(stats[0].avgScore).toBeCloseTo(0.4, 2); // (0.5 + 0.3) / 2
      expect(stats[0].signals).toBe(2);
      expect(stats[1].source).toBe('social');
      expect(stats[1].avgScore).toBeCloseTo(-0.2, 2);
      expect(stats[1].signals).toBe(1);
    });

    it('should return empty array for empty signals', () => {
      const stats = computeBySourceStats([]);
      expect(stats).toHaveLength(0);
    });
  });

  describe('deriveDrivers', () => {
    it('should group signals by label and compute weights with id and user-facing label', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.5,
          weight: 1.0,
          timestamp: new Date(),
          label: 'earnings',
        },
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.3,
          weight: 1.0,
          timestamp: new Date(),
          label: 'earnings',
        },
        {
          symbol: 'AAPL',
          source: 'social',
          normalizedScore: -0.2,
          weight: 1.0,
          timestamp: new Date(),
          label: 'regulation',
        },
      ];

      const drivers = deriveDrivers(signals);
      expect(drivers.length).toBeGreaterThan(0);
      expect(drivers.length).toBeLessThanOrEqual(5);
      expect(drivers[0].id).toBe('earnings');
      expect(drivers[0].label).toBe('Earnings'); // fallback title-case
      expect(drivers[0].label).not.toBe(drivers[0].id);
    });

    it('should set id and user-facing label for price_momentum and fear_greed_index', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'BTC',
          source: 'price_action',
          normalizedScore: 0.3,
          weight: 0.5,
          timestamp: new Date(),
          label: 'price_momentum',
        },
        {
          symbol: 'BTC',
          source: 'crypto_fear_greed',
          normalizedScore: -0.7,
          weight: 1.0,
          timestamp: new Date(),
          label: 'fear_greed_index',
        },
      ];

      const drivers = deriveDrivers(signals);
      expect(drivers.length).toBe(2);

      const priceDriver = drivers.find((d) => d.id === 'price_momentum');
      const fearDriver = drivers.find((d) => d.id === 'fear_greed_index');
      expect(priceDriver).toBeDefined();
      expect(fearDriver).toBeDefined();
      expect(priceDriver!.id).toBe('price_momentum');
      expect(priceDriver!.label).toBe('recent price action');
      expect(priceDriver!.label).not.toBe(priceDriver!.id);
      expect(fearDriver!.id).toBe('fear_greed_index');
      expect(fearDriver!.label).toBe('Crypto Fear & Greed index');
      expect(fearDriver!.label).not.toBe(fearDriver!.id);
    });

    it('should handle signals without labels', () => {
      const signals: NormalizedSentimentSignal[] = [
        {
          symbol: 'AAPL',
          source: 'news',
          normalizedScore: 0.5,
          weight: 1.0,
          timestamp: new Date(),
        },
      ];

      const drivers = deriveDrivers(signals);
      expect(drivers.length).toBe(1);
      expect(drivers[0].id).toBe('unknown');
      expect(drivers[0].label).toBe('general market sentiment');
    });
  });
});
