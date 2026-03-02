import { promptBuilder } from '../promptBuilder';
import type { RiskContextForLLM } from '../../risk/riskOrchestrator';
import type { RiskEvaluationResult } from '../../risk/riskTypes';

describe('PromptBuilder - Risk Prompts', () => {
  describe('buildRiskPrompt', () => {
    it('should include all key sections in risk prompt', () => {
      const riskContext: RiskContextForLLM = {
        userContext: {
          userId: 'user1',
          riskProfile: 'moderate',
          experienceLevel: 'intermediate',
          typicalRiskPerTradePct: 1.0,
          typicalPositionSizeUsd: 1000,
        },
        accountStateSummary: {
          equityUsd: 10000,
          availableMarginUsd: 5000,
          openRiskUsd: 200,
          openPositionsCount: 2,
        },
        profileMetrics: {
          userId: 'user1',
          typicalRiskPerTradePct: 1.0,
          typicalPositionSizeUsd: 1000,
          avgRrRatio: 2.5,
          maxDrawdownPct: 10.0,
          lastComputedAt: new Date(),
        },
        marketSnapshot: {
          symbol: 'EURUSD',
          currentPrice: 1.1000,
          sessionVolatilityPct: 0.5,
        },
        riskEvaluation: {
          riskMetrics: {
            riskPerTradeUsd: 100,
            riskPerTradePct: 1.0,
            rewardUsd: 200,
            rrRatio: 2.0,
            totalRiskUsd: 300,
            totalRiskPct: 3.0,
            effectiveLeverage: 1.1,
            riskVsTypicalFactor: 1.0,
            sizeVsTypicalFactor: 1.0,
          },
          policyFlags: [
            {
              code: 'RISK_PER_TRADE_TOO_HIGH',
              severity: 'warning',
              message: 'Risk per trade (1.5%) exceeds moderate profile limit (1.0%)',
            },
          ],
          engineVersion: '2026-02-02',
        },
        missingFields: [],
      };

      const prompt = promptBuilder.buildSystemPrompt({
        userLevel: 'intermediate',
        intent: 'risk_evaluation',
        riskContext,
      });

      // Check for key sections
      expect(prompt).toContain('trading risk assistant');
      expect(prompt).toContain('BACKEND_RISK_CONTEXT');
      expect(prompt).toContain('UserContext');
      expect(prompt).toContain('AccountStateSummary');
      expect(prompt).toContain('RiskMetrics');
      expect(prompt).toContain('PolicyFlags');
      expect(prompt).toContain('Summary');
      expect(prompt).toContain('Key Numbers');
      expect(prompt).toContain('Policy Evaluation');
      expect(prompt).toContain('Guidance & Alternatives');
      expect(prompt).toContain('Uncertainty & Limitations');
    });

    it('should preserve numeric values exactly', () => {
      const riskContext: RiskContextForLLM = {
        userContext: {
          userId: 'user1',
          riskProfile: 'moderate',
          experienceLevel: 'intermediate',
          typicalRiskPerTradePct: 1.0,
          typicalPositionSizeUsd: 1000,
        },
        accountStateSummary: {
          equityUsd: 10000.123456,
          availableMarginUsd: 5000.789012,
          openRiskUsd: 200.345678,
          openPositionsCount: 2,
        },
        profileMetrics: null,
        marketSnapshot: {
          symbol: 'EURUSD',
          currentPrice: 1.10001234,
        },
        riskEvaluation: {
          riskMetrics: {
            riskPerTradeUsd: 100.567890,
            riskPerTradePct: 1.0056789,
            rewardUsd: 200.123456,
            rrRatio: 2.0012345,
            totalRiskUsd: 300.789012,
            totalRiskPct: 3.0078901,
            effectiveLeverage: 1.1234567,
            riskVsTypicalFactor: 1.0056789,
            sizeVsTypicalFactor: 1.0012345,
          },
          policyFlags: [],
          engineVersion: '2026-02-02',
        },
        missingFields: [],
      };

      const prompt = promptBuilder.buildSystemPrompt({
        userLevel: 'intermediate',
        intent: 'risk_evaluation',
        riskContext,
      });

      // Check that exact values appear (formatted appropriately)
      expect(prompt).toContain('10000.12'); // equityUsd formatted
      expect(prompt).toContain('100.57'); // riskPerTradeUsd formatted
      expect(prompt).toContain('1.01'); // riskPerTradePct formatted
      expect(prompt).toContain('2.00'); // rrRatio formatted
    });

    it('should show clarification mode when fields are missing', () => {
      const riskContext: RiskContextForLLM = {
        userContext: {
          userId: 'user1',
          riskProfile: 'moderate',
          experienceLevel: 'intermediate',
          typicalRiskPerTradePct: 1.0,
          typicalPositionSizeUsd: 1000,
        },
        accountStateSummary: {
          equityUsd: 10000,
          availableMarginUsd: 5000,
          openRiskUsd: 200,
          openPositionsCount: 2,
        },
        profileMetrics: null,
        marketSnapshot: {
          symbol: 'EURUSD',
          currentPrice: 1.1000,
        },
        riskEvaluation: null,
        missingFields: ['stopPrice', 'quantity'],
      };

      const prompt = promptBuilder.buildSystemPrompt({
        userLevel: 'intermediate',
        intent: 'risk_evaluation',
        riskContext,
      });

      expect(prompt).toContain('CLARIFICATION MODE');
      expect(prompt).toContain('stopPrice');
      expect(prompt).toContain('quantity');
      expect(prompt).not.toContain('RiskMetrics'); // Should not show metrics
      expect(prompt).toContain('Do NOT show any risk metrics');
    });
  });
});
