import { intentDetector } from '../intentDetector';
import { conversationStore } from '../conversationStore';

// Mock dependencies
jest.mock('../groqCompoundClient');
jest.mock('../conversationStore');

describe('IntentDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Risk-related intent detection', () => {
    it('should detect risk_evaluation intent for "Is this trade too risky?"', async () => {
      const mockDetectIntent = require('../groqCompoundClient').groqCompoundClient.detectIntent;
      mockDetectIntent.mockResolvedValue({
        intents: [{ intent: 'risk_evaluation', confidence: 0.95 }],
        primaryIntent: 'risk_evaluation',
        user_level: 'intermediate',
      });

      const mockGetMetadata = conversationStore.getSessionMetadata as jest.Mock;
      mockGetMetadata.mockResolvedValue(null);

      const result = await intentDetector.detectIntent(
        'Is this trade too risky?',
        'test-session-id',
        []
      );

      expect(result.primaryIntent).toBe('risk_evaluation');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('risk_evaluation');
      expect(result.isRiskRelated).toBe(true);
    });

    it('should detect position_sizing intent for "How big should my position be?"', async () => {
      const mockDetectIntent = require('../groqCompoundClient').groqCompoundClient.detectIntent;
      mockDetectIntent.mockResolvedValue({
        intents: [{ intent: 'position_sizing', confidence: 0.92 }],
        primaryIntent: 'position_sizing',
        user_level: 'advanced',
      });

      const mockGetMetadata = conversationStore.getSessionMetadata as jest.Mock;
      mockGetMetadata.mockResolvedValue(null);

      const result = await intentDetector.detectIntent(
        'How big should my position be?',
        'test-session-id',
        []
      );

      expect(result.primaryIntent).toBe('position_sizing');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('position_sizing');
      expect(result.isRiskRelated).toBe(true);
    });

    it('should detect risk_policy_explanation intent for "Why is my risk limit 1%?"', async () => {
      const mockDetectIntent = require('../groqCompoundClient').groqCompoundClient.detectIntent;
      mockDetectIntent.mockResolvedValue({
        intents: [{ intent: 'risk_policy_explanation', confidence: 0.88 }],
        primaryIntent: 'risk_policy_explanation',
        user_level: 'intermediate',
      });

      const mockGetMetadata = conversationStore.getSessionMetadata as jest.Mock;
      mockGetMetadata.mockResolvedValue(null);

      const result = await intentDetector.detectIntent(
        'Why is my risk limit 1%?',
        'test-session-id',
        []
      );

      expect(result.primaryIntent).toBe('risk_policy_explanation');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('risk_policy_explanation');
      expect(result.isRiskRelated).toBe(true);
    });

    it('should set isRiskRelated flag based on keywords even if LLM returns different intent', async () => {
      const mockDetectIntent = require('../groqCompoundClient').groqCompoundClient.detectIntent;
      mockDetectIntent.mockResolvedValue({
        intents: [{ intent: 'analysis', confidence: 0.85 }], // LLM might classify as analysis
        primaryIntent: 'analysis',
        user_level: 'intermediate',
      });

      const mockGetMetadata = conversationStore.getSessionMetadata as jest.Mock;
      mockGetMetadata.mockResolvedValue(null);

      // Message contains risk keywords
      const result = await intentDetector.detectIntent(
        'What is my risk per trade for this position?',
        'test-session-id',
        []
      );

      // Should still be marked as risk-related due to keywords
      expect(result.isRiskRelated).toBe(true);
    });
  });
});
