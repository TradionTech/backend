import { evaluateRiskPolicy, defaultRiskPolicyConfig } from '../riskPolicy';
import type { UserContext, RiskMetrics } from '../riskTypes';

describe('RiskPolicy', () => {
  const baseUserContext: UserContext = {
    userId: 'user-123',
    riskProfile: 'moderate',
    experienceLevel: 'intermediate',
    typicalRiskPerTradePct: 1.0,
    typicalPositionSizeUsd: 1500,
  };

  const baseMetrics: RiskMetrics = {
    riskPerTradeUsd: 50,
    riskPerTradePct: 0.5,
    rewardUsd: 100,
    rrRatio: 2.0,
    totalRiskUsd: 200,
    totalRiskPct: 2.0,
    effectiveLeverage: 1.5,
    riskVsTypicalFactor: 0.5,
    sizeVsTypicalFactor: 0.75,
  };

  describe('evaluateRiskPolicy', () => {
    it('should return no flags for a compliant trade', () => {
      const flags = evaluateRiskPolicy(baseUserContext, baseMetrics);

      expect(flags).toEqual([]);
    });

    it('should flag RISK_PER_TRADE_TOO_HIGH for conservative profile', () => {
      const userContext: UserContext = {
        ...baseUserContext,
        riskProfile: 'conservative',
      };

      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 0.6, // Exceeds conservative limit of 0.5%
      };

      const flags = evaluateRiskPolicy(userContext, metrics);

      expect(flags.length).toBeGreaterThan(0);
      expect(flags.some(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')).toBe(true);
      const flag = flags.find(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')!;
      expect(flag.severity).toBeDefined();
      expect(flag.message).toContain('conservative');
    });

    it('should flag RISK_PER_TRADE_TOO_HIGH for moderate profile', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 1.5, // Exceeds moderate limit of 1.0%
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')).toBe(true);
    });

    it('should flag RISK_PER_TRADE_TOO_HIGH for aggressive profile', () => {
      const userContext: UserContext = {
        ...baseUserContext,
        riskProfile: 'aggressive',
      };

      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 2.5, // Exceeds aggressive limit of 2.0%
      };

      const flags = evaluateRiskPolicy(userContext, metrics);

      expect(flags.some(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')).toBe(true);
    });

    it('should flag TOTAL_RISK_TOO_HIGH', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        totalRiskPct: 6.0, // Exceeds maxTotalOpenRiskPct of 5.0%
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'TOTAL_RISK_TOO_HIGH')).toBe(true);
      const flag = flags.find(f => f.code === 'TOTAL_RISK_TOO_HIGH')!;
      expect(flag.message).toContain('Total open risk');
    });

    it('should flag LEVERAGE_TOO_HIGH', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        effectiveLeverage: 4.0, // Exceeds maxLeverage of 3.0
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'LEVERAGE_TOO_HIGH')).toBe(true);
      const flag = flags.find(f => f.code === 'LEVERAGE_TOO_HIGH')!;
      expect(flag.message).toContain('leverage');
    });

    it('should flag RR_TOO_LOW', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        rrRatio: 1.5, // Below minRrRatio of 2.0
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'RR_TOO_LOW')).toBe(true);
      const flag = flags.find(f => f.code === 'RR_TOO_LOW')!;
      expect(flag.message).toContain('Risk-reward ratio');
    });

    it('should not flag RR_TOO_LOW when rrRatio is null', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        rrRatio: null,
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'RR_TOO_LOW')).toBe(false);
    });

    it('should flag ABOVE_TYPICAL_RISK', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskVsTypicalFactor: 2.5, // Exceeds maxRiskVsTypicalFactor of 2.0
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'ABOVE_TYPICAL_RISK')).toBe(true);
      const flag = flags.find(f => f.code === 'ABOVE_TYPICAL_RISK')!;
      expect(flag.message).toContain('typical risk');
    });

    it('should flag ABOVE_TYPICAL_SIZE', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        sizeVsTypicalFactor: 2.5, // Exceeds maxSizeVsTypicalFactor of 2.0
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'ABOVE_TYPICAL_SIZE')).toBe(true);
      const flag = flags.find(f => f.code === 'ABOVE_TYPICAL_SIZE')!;
      expect(flag.message).toContain('typical position size');
    });

    it('should return multiple flags when multiple violations occur', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 1.5, // Exceeds moderate limit
        totalRiskPct: 6.0, // Exceeds total risk limit
        effectiveLeverage: 4.0, // Exceeds leverage limit
        rrRatio: 1.5, // Below RR limit
        riskVsTypicalFactor: 2.5, // Exceeds typical risk factor
        sizeVsTypicalFactor: 2.5, // Exceeds typical size factor
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.length).toBe(6);
      expect(flags.some(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')).toBe(true);
      expect(flags.some(f => f.code === 'TOTAL_RISK_TOO_HIGH')).toBe(true);
      expect(flags.some(f => f.code === 'LEVERAGE_TOO_HIGH')).toBe(true);
      expect(flags.some(f => f.code === 'RR_TOO_LOW')).toBe(true);
      expect(flags.some(f => f.code === 'ABOVE_TYPICAL_RISK')).toBe(true);
      expect(flags.some(f => f.code === 'ABOVE_TYPICAL_SIZE')).toBe(true);
    });

    it('should assign appropriate severity based on violation magnitude', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 2.0, // Moderate violation (1.0% over 1.0% limit = 100% excess)
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      const flag = flags.find(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')!;
      expect(['info', 'warning', 'high']).toContain(flag.severity);
    });

    it('should use custom policy config when provided', () => {
      const customConfig = {
        ...defaultRiskPolicyConfig,
        maxRiskPerTradePct: {
          conservative: 0.3,
          moderate: 0.8,
          aggressive: 1.5,
        },
        maxLeverage: 2.0,
      };

      const metrics: RiskMetrics = {
        ...baseMetrics,
        effectiveLeverage: 2.5, // Exceeds custom maxLeverage of 2.0
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics, customConfig);

      expect(flags.some(f => f.code === 'LEVERAGE_TOO_HIGH')).toBe(true);
    });

    it('should handle edge case with very small violations', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 1.01, // Just slightly over 1.0% limit
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      expect(flags.some(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')).toBe(true);
      const flag = flags.find(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')!;
      expect(flag.severity).toBe('info'); // Small violation should be info
    });

    it('should handle edge case with very large violations', () => {
      const metrics: RiskMetrics = {
        ...baseMetrics,
        riskPerTradePct: 5.0, // 5x over 1.0% limit
      };

      const flags = evaluateRiskPolicy(baseUserContext, metrics);

      const flag = flags.find(f => f.code === 'RISK_PER_TRADE_TOO_HIGH')!;
      expect(flag.severity).toBe('high'); // Large violation should be high
    });
  });
});
