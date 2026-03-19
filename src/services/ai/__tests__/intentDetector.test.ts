import { intentDetector } from '../intentDetector';
import { conversationStore } from '../conversationStore';

// Mock dependencies
jest.mock('../conversationStore');
jest.mock('../llm/chatLLM');

describe('IntentDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Smalltalk intent detection', () => {
    it('should fast-path smalltalk for greetings and skip LLM', async () => {
      const { getChatLLM } = require('../llm/chatLLM');
      const mockGetMetadata = conversationStore.getSessionMetadata as jest.Mock;
      mockGetMetadata.mockResolvedValue({ user_level: 'intermediate' });

      const result = await intentDetector.detectIntent('hello', 'test-session-id', []);

      expect(result.primaryIntent).toBe('smalltalk');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].intent).toBe('smalltalk');
      expect(getChatLLM).not.toHaveBeenCalled();
    });
  });

  describe('Risk-related intent detection', () => {
    it('should detect risk_evaluation intent for "Is this trade too risky?"', async () => {
      const { getChatLLM } = require('../llm/chatLLM');
      const mockCompleteChat = jest.fn().mockResolvedValue({
        id: 'intent-1',
        content: JSON.stringify({
          intents: [{ intent: 'risk_evaluation', confidence: 0.95 }],
          primaryIntent: 'risk_evaluation',
          user_level: 'intermediate',
        }),
        finishReason: 'stop',
      });
      getChatLLM.mockReturnValue({ completeChat: mockCompleteChat });

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
      const { getChatLLM } = require('../llm/chatLLM');
      const mockCompleteChat = jest.fn().mockResolvedValue({
        id: 'intent-2',
        content: JSON.stringify({
          intents: [{ intent: 'position_sizing', confidence: 0.92 }],
          primaryIntent: 'position_sizing',
          user_level: 'advanced',
        }),
        finishReason: 'stop',
      });
      getChatLLM.mockReturnValue({ completeChat: mockCompleteChat });

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
      const { getChatLLM } = require('../llm/chatLLM');
      const mockCompleteChat = jest.fn().mockResolvedValue({
        id: 'intent-3',
        content: JSON.stringify({
          intents: [{ intent: 'risk_policy_explanation', confidence: 0.88 }],
          primaryIntent: 'risk_policy_explanation',
          user_level: 'intermediate',
        }),
        finishReason: 'stop',
      });
      getChatLLM.mockReturnValue({ completeChat: mockCompleteChat });

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
      const { getChatLLM } = require('../llm/chatLLM');
      const mockCompleteChat = jest.fn().mockResolvedValue({
        id: 'intent-4',
        content: JSON.stringify({
          intents: [{ intent: 'analysis', confidence: 0.85 }],
          primaryIntent: 'analysis',
          user_level: 'intermediate',
        }),
        finishReason: 'stop',
      });
      getChatLLM.mockReturnValue({ completeChat: mockCompleteChat });

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
