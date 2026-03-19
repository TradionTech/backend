import { ChatOrchestrator } from '../chatOrchestrator';
import { conversationStore } from '../conversationStore';
import { intentDetector } from '../intentDetector';
import { groqCompoundClient } from '../groqCompoundClient';
import { marketContextService } from '../../market/marketContextService';
import { ChatSession } from '../../../db/models/ChatSession';
import { ChatMessage } from '../../../db/models/ChatMessage';

jest.mock('../conversationStore');
jest.mock('../intentDetector');
jest.mock('../groqCompoundClient');
jest.mock('../../market/marketContextService');
jest.mock('../../../db/models/ChatSession');
jest.mock('../../../db/models/ChatMessage');

const mockedConversationStore = conversationStore as jest.Mocked<typeof conversationStore>;
const mockedIntentDetector = intentDetector as jest.Mocked<typeof intentDetector>;
const mockedGroqClient = groqCompoundClient as jest.Mocked<typeof groqCompoundClient>;
const mockedMarketContextService = marketContextService as jest.Mocked<typeof marketContextService>;

describe('ChatOrchestrator', () => {
  let orchestrator: ChatOrchestrator;
  let mockSession: Partial<ChatSession>;

  beforeEach(() => {
    orchestrator = new ChatOrchestrator();
    mockSession = {
      id: 'session-123',
      userId: 'user-123',
    };

    jest.clearAllMocks();
  });

  describe('processMessage', () => {
    it('should handle smalltalk with a lightweight response (no JSON mode)', async () => {
      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'smalltalk', confidence: 0.95 }],
        primaryIntent: 'smalltalk',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      } as any);

      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-hello',
        content: 'Hi there! How can I help?',
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValue({} as ChatMessage);

      const result = await orchestrator.processMessage({
        userId: 'user-123',
        message: 'hello',
      });

      expect(result.primaryIntent).toBe('smalltalk');
      expect(result.message.length).toBeGreaterThan(0);

      const groqCall = mockedGroqClient.completeChat.mock.calls[0][0];
      expect(groqCall.responseFormat).toBeUndefined();
      expect(mockedMarketContextService.getContext).not.toHaveBeenCalled();
    });

    it('should retry once if LLM returns empty content', async () => {
      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'clarification', confidence: 0.9 }],
        primaryIntent: 'clarification',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });

      mockedGroqClient.completeChat
        .mockResolvedValueOnce({
          id: 'response-empty',
          content: '',
          finishReason: 'stop',
        })
        .mockResolvedValueOnce({
          id: 'response-retry',
          content: 'Sure — what would you like me to clarify?',
          finishReason: 'stop',
        });

      mockedConversationStore.saveMessage.mockResolvedValue({} as ChatMessage);

      const result = await orchestrator.processMessage({
        userId: 'user-123',
        message: 'how are you',
      });

      expect(result.message).toContain('clarify');
      expect(mockedGroqClient.completeChat).toHaveBeenCalledTimes(2);
    });
    it('should process a message and return structured response', async () => {
      const mockResponse = `**Facts:**
Bitcoin is a decentralized cryptocurrency.

**Interpretation:**
The price is influenced by multiple factors.

**Risk & Uncertainty:**
Trading carries risk and markets are unpredictable.`;

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'education', confidence: 0.95 }],
        primaryIntent: 'education',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: mockResponse,
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      const result = await orchestrator.processMessage({
        userId: 'user-123',
        message: 'What is Bitcoin?',
      });

      expect(result.conversationId).toBe('session-123');
      expect(result.primaryIntent).toBe('education');
      expect(result.intents).toContain('education');
      expect(result.user_level).toBe('intermediate');
      expect(result.sections.facts).toContain('Bitcoin');
      expect(result.sections.interpretation).toBeDefined();
      expect(result.sections.risk_and_uncertainty).toBeDefined();
      expect(mockedConversationStore.saveMessage).toHaveBeenCalledTimes(2); // user + assistant
    });

    it('should handle conversation history', async () => {
      const history = [
        { role: 'user' as const, content: 'Previous message' },
        { role: 'assistant' as const, content: 'Previous response' },
      ];

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce(history);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'clarification', confidence: 0.9 }],
        primaryIntent: 'clarification',
        user_level: 'novice',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: 'Response',
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      await orchestrator.processMessage({
        userId: 'user-123',
        conversationId: 'session-123',
        message: 'Can you clarify?',
      });

      expect(mockedGroqClient.completeChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            ...history,
            expect.objectContaining({ role: 'user', content: 'Can you clarify?' }),
          ]),
        })
      );
    });

    it('should apply safety guardrails when unsafe content detected', async () => {
      const unsafeResponse = 'You should buy Bitcoin at $50,000 now';

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'analysis', confidence: 0.9 }],
        primaryIntent: 'analysis',
        user_level: 'advanced',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: unsafeResponse,
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      const result = await orchestrator.processMessage({
        userId: 'user-123',
        message: 'Should I buy?',
      });

      // Should have been replaced with fallback
      expect(result.message).not.toContain('You should buy');
      expect(result.message).toContain("I can't provide");
    });

    it('should detect low confidence from uncertainty indicators', async () => {
      const uncertainResponse = `**Facts:**
Limited information available. The data is unclear and incomplete.

**Interpretation:**
It's uncertain what this means. We don't know the full context.

**Risk & Uncertainty:**
Confidence is low. Missing critical information.`;

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'education', confidence: 0.95 }],
        primaryIntent: 'education',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: uncertainResponse,
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      const result = await orchestrator.processMessage({
        userId: 'user-123',
        message: 'Test',
      });

      expect(result.low_confidence).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockedConversationStore.getOrCreateConversation.mockRejectedValueOnce(
        new Error('Database error')
      );

      await expect(
        orchestrator.processMessage({
          userId: 'user-123',
          message: 'Test',
        })
      ).rejects.toThrow('Failed to process chat message');
    });

    it('should call MarketContextService when message contains symbol', async () => {
      const mockResponse = `**Facts:**
Market data for EURUSD.

**Interpretation:**
Analysis of the pair.

**Risk & Uncertainty:**
Trading risks.`;

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'analysis', confidence: 0.9 }],
        primaryIntent: 'analysis',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedMarketContextService.getContext.mockResolvedValueOnce({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'EURUSD', assetClass: 'FX', base: 'EUR', quote: 'USD' },
          timeframe: { unit: 'H', size: 1, label: '1 Hour' },
          priceSnapshot: {
            last: 1.1,
            changePct: 0.5,
            high: 1.105,
            low: 1.095,
            timestamp: Date.now(),
          },
          trendSignals: { trend: 'up', basis: 'short_term' },
          volatilitySignals: { volatilityLevel: 'medium', metric: 'std_dev', value: 1.2 },
          dataQuality: { isFresh: true, source: 'dummy' },
        },
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: mockResponse,
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      await orchestrator.processMessage({
        userId: 'user-123',
        message: 'What is the current price of EURUSD?',
        metadata: { instrument: 'EURUSD' },
      });

      expect(mockedMarketContextService.getContext).toHaveBeenCalled();
      const contextCall = mockedMarketContextService.getContext.mock.calls[0][0];
      expect(contextCall.symbol).toBe('EURUSD');
    });

    it('should still respond when MarketContextService fails', async () => {
      const mockResponse = `**Facts:**
I don't have current market data available.

**Interpretation:**
General trading principles.

**Risk & Uncertainty:**
Trading risks.`;

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'analysis', confidence: 0.9 }],
        primaryIntent: 'analysis',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedMarketContextService.getContext.mockResolvedValueOnce({
        contextAvailable: false,
        reason: 'PROVIDER_ERROR',
        error: 'Provider unavailable',
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: mockResponse,
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      const result = await orchestrator.processMessage({
        userId: 'user-123',
        message: 'What is the price of EURUSD?',
        metadata: { instrument: 'EURUSD' },
      });

      expect(result).toBeDefined();
      expect(result.message).toBeDefined();
      expect(mockedMarketContextService.getContext).toHaveBeenCalled();
    });

    it('should include market context in system prompt when available', async () => {
      const mockResponse = 'Response with market context';

      mockedConversationStore.getOrCreateConversation.mockResolvedValueOnce(
        mockSession as ChatSession
      );
      mockedConversationStore.getRecentMessages.mockResolvedValueOnce([]);
      mockedIntentDetector.detectIntent.mockResolvedValueOnce({
        intents: [{ intent: 'analysis', confidence: 0.9 }],
        primaryIntent: 'analysis',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      });
      mockedMarketContextService.getContext.mockResolvedValueOnce({
        contextAvailable: true,
        context: {
          instrument: { symbol: 'BTC', assetClass: 'CRYPTO' },
          priceSnapshot: { last: 50000, timestamp: Date.now() },
          dataQuality: { isFresh: true, source: 'dummy' },
        },
      });
      mockedGroqClient.completeChat.mockResolvedValueOnce({
        id: 'response-123',
        content: mockResponse,
        finishReason: 'stop',
      });
      mockedConversationStore.saveMessage.mockResolvedValueOnce({} as ChatMessage);

      await orchestrator.processMessage({
        userId: 'user-123',
        message: 'Analyze BTC',
      });

      // Verify that Groq was called with a system prompt containing market context
      const groqCall = mockedGroqClient.completeChat.mock.calls[0][0];
      const systemMessage = groqCall.messages.find((m) => m.role === 'system');
      expect(systemMessage).toBeDefined();
      expect(systemMessage?.content).toContain('MARKET CONTEXT');
      expect(systemMessage?.content).toContain('BTC');
    });
  });
});
