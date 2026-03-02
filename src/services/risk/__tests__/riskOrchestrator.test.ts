import { riskOrchestrator } from '../riskOrchestrator';
import { getUserProfileMetrics } from '../../profile/profileService';
import { evaluateTradeRisk } from '../riskEngine';
import { User } from '../../../db/models/User';
import { MetaApiAccount } from '../../../db/models/MetaApiAccount';
import { AccountEquitySnapshot } from '../../../db/models/AccountEquitySnapshot';
import { TradingPosition } from '../../../db/models/TradingPosition';

// Mock dependencies
jest.mock('../../profile/profileService');
jest.mock('../riskEngine');
jest.mock('../../../db/models/User');
jest.mock('../../../db/models/MetaApiAccount');
jest.mock('../../../db/models/AccountEquitySnapshot');
jest.mock('../../../db/models/TradingPosition');
jest.mock('../market/marketContextService');
jest.mock('../ai/groqCompoundClient');

describe('RiskOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectMissingFields', () => {
    it('should detect all missing required fields', () => {
      const missing = riskOrchestrator.detectMissingFields(null);
      expect(missing).toEqual(['symbol', 'side', 'entryPrice', 'stopPrice', 'quantity', 'timeframe']);
    });

    it('should detect specific missing fields', () => {
      const partialIntent = {
        symbol: 'EURUSD',
        side: 'long' as const,
        // Missing: entryPrice, stopPrice, quantity, timeframe
      };
      const missing = riskOrchestrator.detectMissingFields(partialIntent);
      expect(missing).toContain('entryPrice');
      expect(missing).toContain('stopPrice');
      expect(missing).toContain('quantity');
      expect(missing).toContain('timeframe');
      expect(missing).not.toContain('symbol');
      expect(missing).not.toContain('side');
    });

    it('should return empty array when all required fields present', () => {
      const completeIntent = {
        symbol: 'EURUSD',
        side: 'long' as const,
        entryPrice: 1.1000,
        stopPrice: 1.0950,
        quantity: 0.1,
        timeframe: 'intraday' as const,
        orderType: 'market' as const,
      };
      const missing = riskOrchestrator.detectMissingFields(completeIntent);
      expect(missing).toEqual([]);
    });

    it('should detect invalid numeric fields (zero or negative)', () => {
      const invalidIntent = {
        symbol: 'EURUSD',
        side: 'long' as const,
        entryPrice: 0, // Invalid
        stopPrice: -1, // Invalid
        quantity: 0.1,
        timeframe: 'intraday' as const,
      };
      const missing = riskOrchestrator.detectMissingFields(invalidIntent);
      expect(missing).toContain('entryPrice');
      expect(missing).toContain('stopPrice');
    });
  });

  describe('computeMaxQuantityForRiskLimit', () => {
    it('should compute correct max quantity', () => {
      const maxQty = riskOrchestrator.computeMaxQuantityForRiskLimit(1.1000, 1.0950, 100);
      // Risk per unit = 0.005, maxRisk = 100, so maxQty = 100 / 0.005 = 20000
      expect(maxQty).toBeCloseTo(20000, 2);
    });

    it('should return 0 for invalid prices', () => {
      const maxQty = riskOrchestrator.computeMaxQuantityForRiskLimit(1.1000, 1.1000, 100);
      expect(maxQty).toBe(0);
    });
  });

  describe('computeStopForRiskLimit', () => {
    it('should compute stop for long position', () => {
      const stop = riskOrchestrator.computeStopForRiskLimit(1.1000, 0.1, 50, 'long');
      // Risk per unit = 50 / 0.1 = 500, stop = 1.1000 - 500 = 0.6000
      expect(stop).toBeCloseTo(0.6000, 4);
    });

    it('should compute stop for short position', () => {
      const stop = riskOrchestrator.computeStopForRiskLimit(1.1000, 0.1, 50, 'short');
      // Risk per unit = 50 / 0.1 = 500, stop = 1.1000 + 500 = 1.6000
      expect(stop).toBeCloseTo(1.6000, 4);
    });

    it('should return entry price for zero quantity', () => {
      const stop = riskOrchestrator.computeStopForRiskLimit(1.1000, 0, 50, 'long');
      expect(stop).toBe(1.1000);
    });
  });

  describe('buildRiskContext', () => {
    it('should handle missing fields and return clarification context', async () => {
      // Mock all dependencies
      (User.findByPk as jest.Mock).mockResolvedValue({ id: 'user1' });
      (getUserProfileMetrics as jest.Mock).mockResolvedValue(null);
      (MetaApiAccount.findAll as jest.Mock).mockResolvedValue([]);
      (require('../ai/groqCompoundClient').groqCompoundClient.completeChat as jest.Mock).mockResolvedValue({
        content: '{}', // Empty trade intent
      });

      const context = await riskOrchestrator.buildRiskContext(
        'user1',
        'I want to trade EURUSD',
        []
      );

      expect(context.missingFields.length).toBeGreaterThan(0);
      expect(context.riskEvaluation).toBeNull();
    });

    it('should evaluate risk when all fields present', async () => {
      // Mock dependencies
      (User.findByPk as jest.Mock).mockResolvedValue({ id: 'user1' });
      (getUserProfileMetrics as jest.Mock).mockResolvedValue({
        userId: 'user1',
        typicalRiskPerTradePct: 1.0,
        typicalPositionSizeUsd: 1000,
        avgRrRatio: 2.5,
        maxDrawdownPct: 10.0,
        lastComputedAt: new Date(),
      });
      (MetaApiAccount.findAll as jest.Mock).mockResolvedValue([]);
      (evaluateTradeRisk as jest.Mock).mockReturnValue({
        riskMetrics: {
          riskPerTradeUsd: 100,
          riskPerTradePct: 1.0,
          rewardUsd: 200,
          rrRatio: 2.0,
          totalRiskUsd: 100,
          totalRiskPct: 1.0,
          effectiveLeverage: 1.0,
          riskVsTypicalFactor: 1.0,
          sizeVsTypicalFactor: 1.0,
        },
        policyFlags: [],
        engineVersion: '2026-02-02',
      });
      (require('../ai/groqCompoundClient').groqCompoundClient.completeChat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          symbol: 'EURUSD',
          side: 'long',
          entryPrice: 1.1000,
          stopPrice: 1.0950,
          quantity: 0.1,
          timeframe: 'intraday',
          orderType: 'market',
        }),
      });

      const context = await riskOrchestrator.buildRiskContext(
        'user1',
        'I want to buy EURUSD at 1.1000 with stop at 1.0950, 0.1 lots',
        []
      );

      expect(context.missingFields).toEqual([]);
      expect(context.riskEvaluation).not.toBeNull();
      expect(evaluateTradeRisk).toHaveBeenCalled();
    });
  });
});
