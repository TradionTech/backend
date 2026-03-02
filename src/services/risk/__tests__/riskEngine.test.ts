import { computeRiskMetrics, evaluateTradeRisk } from '../riskEngine';
import type { RiskEvaluationRequest } from '../riskTypes';

describe('RiskEngine', () => {
  const baseRequest: RiskEvaluationRequest = {
    userContext: {
      userId: 'user-123',
      riskProfile: 'moderate',
      experienceLevel: 'intermediate',
      typicalRiskPerTradePct: 1.0,
      typicalPositionSizeUsd: 1500,
    },
    accountState: {
      accountId: 'acc-123',
      equityUsd: 10000,
      availableMarginUsd: 5000,
      openRiskUsd: 200,
      openPositions: [
        { symbol: 'EURUSD', riskUsd: 200 },
      ],
    },
    tradeIntent: {
      symbol: 'EURUSD',
      side: 'long',
      entryPrice: 1.1000,
      stopPrice: 1.0950,
      targetPrice: 1.1100,
      quantity: 1000,
      leverage: null,
      timeframe: 'swing',
      orderType: 'limit',
    },
    marketSnapshot: {
      symbol: 'EURUSD',
      currentPrice: 1.1000,
      atr: 0.0050,
      tickSize: 0.0001,
      minNotional: 100,
      maxLeverageAllowed: 50,
      sessionVolatilityPct: 0.5,
    },
  };

  describe('computeRiskMetrics', () => {
    it('should calculate basic metrics for a long trade with target', () => {
      const metrics = computeRiskMetrics(baseRequest);

      // Risk per trade: |1.1000 - 1.0950| * 1000 = 50 USD
      expect(metrics.riskPerTradeUsd).toBe(50);
      
      // Risk per trade %: (50 / 10000) * 100 = 0.5%
      expect(metrics.riskPerTradePct).toBe(0.5);

      // Reward: |1.1100 - 1.1000| * 1000 = 100 USD
      expect(metrics.rewardUsd).toBe(100);

      // RR ratio: 100 / 50 = 2.0
      expect(metrics.rrRatio).toBe(2.0);

      // Total risk: 200 + 50 = 250 USD
      expect(metrics.totalRiskUsd).toBe(250);

      // Total risk %: (250 / 10000) * 100 = 2.5%
      expect(metrics.totalRiskPct).toBe(2.5);

      // Effective leverage: (1.1000 * 1000) / 10000 = 0.11
      expect(metrics.effectiveLeverage).toBe(0.11);

      // Risk vs typical: 0.5 / 1.0 = 0.5
      expect(metrics.riskVsTypicalFactor).toBe(0.5);

      // Size vs typical: (1.1000 * 1000) / 1500 = 0.733...
      expect(metrics.sizeVsTypicalFactor).toBeCloseTo(0.733, 2);
    });

    it('should calculate metrics for a short trade without target', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        tradeIntent: {
          ...baseRequest.tradeIntent,
          side: 'short',
          entryPrice: 1.1000,
          stopPrice: 1.1050,
          targetPrice: null,
        },
      };

      const metrics = computeRiskMetrics(request);

      // Risk per trade: |1.1000 - 1.1050| * 1000 = 50 USD
      expect(metrics.riskPerTradeUsd).toBe(50);
      expect(metrics.rewardUsd).toBeNull();
      expect(metrics.rrRatio).toBeNull();
    });

    it('should handle zero equity edge case', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        accountState: {
          ...baseRequest.accountState,
          equityUsd: 0,
        },
      };

      const metrics = computeRiskMetrics(request);

      expect(metrics.riskPerTradePct).toBe(0);
      expect(metrics.totalRiskPct).toBe(0);
      expect(metrics.effectiveLeverage).toBe(0);
    });

    it('should handle zero quantity edge case', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        tradeIntent: {
          ...baseRequest.tradeIntent,
          quantity: 0,
        },
      };

      const metrics = computeRiskMetrics(request);

      expect(metrics.riskPerTradeUsd).toBe(0);
      expect(metrics.rewardUsd).toBe(0);
      expect(metrics.effectiveLeverage).toBe(0);
    });

    it('should handle identical entry and stop price', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        tradeIntent: {
          ...baseRequest.tradeIntent,
          entryPrice: 1.1000,
          stopPrice: 1.1000,
        },
      };

      const metrics = computeRiskMetrics(request);

      expect(metrics.riskPerTradeUsd).toBe(0);
      expect(metrics.rrRatio).toBeNull();
    });

    it('should calculate leverage correctly with explicit leverage', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        tradeIntent: {
          ...baseRequest.tradeIntent,
          leverage: 2,
        },
      };

      const metrics = computeRiskMetrics(request);

      // Effective leverage is still position value / equity, not the leverage field
      // Position value: 1.1000 * 1000 = 1100
      // Effective leverage: 1100 / 10000 = 0.11
      expect(metrics.effectiveLeverage).toBe(0.11);
    });

    it('should calculate typical factors correctly', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        userContext: {
          ...baseRequest.userContext,
          typicalRiskPerTradePct: 0.5,
          typicalPositionSizeUsd: 2000,
        },
      };

      const metrics = computeRiskMetrics(request);

      // Risk vs typical: 0.5 / 0.5 = 1.0
      expect(metrics.riskVsTypicalFactor).toBe(1.0);

      // Size vs typical: 1100 / 2000 = 0.55
      expect(metrics.sizeVsTypicalFactor).toBe(0.55);
    });

    it('should handle very small typical values with epsilon', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        userContext: {
          ...baseRequest.userContext,
          typicalRiskPerTradePct: 0,
          typicalPositionSizeUsd: 0,
        },
      };

      const metrics = computeRiskMetrics(request);

      // Should not throw and should handle division by zero
      expect(metrics.riskVsTypicalFactor).toBeDefined();
      expect(metrics.sizeVsTypicalFactor).toBeDefined();
    });

    it('should calculate total risk including existing positions', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        accountState: {
          ...baseRequest.accountState,
          openRiskUsd: 500,
        },
      };

      const metrics = computeRiskMetrics(request);

      // Total risk: 500 + 50 = 550 USD
      expect(metrics.totalRiskUsd).toBe(550);
      expect(metrics.totalRiskPct).toBe(5.5);
    });
  });

  describe('evaluateTradeRisk', () => {
    it('should return complete evaluation result', () => {
      const result = evaluateTradeRisk(baseRequest);

      expect(result.riskMetrics).toBeDefined();
      expect(result.policyFlags).toBeDefined();
      expect(Array.isArray(result.policyFlags)).toBe(true);
      expect(result.engineVersion).toBe('2026-02-02');
    });

    it('should include policy flags when violations occur', () => {
      const request: RiskEvaluationRequest = {
        ...baseRequest,
        tradeIntent: {
          ...baseRequest.tradeIntent,
          entryPrice: 1.1000,
          stopPrice: 1.0900, // Larger stop = more risk
          quantity: 20000, // Much larger quantity
        },
        accountState: {
          ...baseRequest.accountState,
          equityUsd: 1000, // Smaller equity
        },
      };

      const result = evaluateTradeRisk(request);

      // Should have at least one policy flag due to high risk
      expect(result.policyFlags.length).toBeGreaterThan(0);
    });
  });
});
