import { ConversationStore } from '../conversationStore';
import { ChatMessage } from '../../../db/models/ChatMessage';
import { ChatSession } from '../../../db/models/ChatSession';
import { getChatLLM } from '../llm/chatLLM';

jest.mock('../../../db/models/ChatMessage');
jest.mock('../../../db/models/ChatSession');
jest.mock('../llm/chatLLM');

const MockChatMessage = ChatMessage as jest.Mocked<typeof ChatMessage>;
const MockChatSession = ChatSession as jest.Mocked<typeof ChatSession>;
const mockGetChatLLM = getChatLLM as jest.MockedFunction<typeof getChatLLM>;

describe('ConversationStore', () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
    jest.clearAllMocks();
    mockGetChatLLM.mockReturnValue({
      completeChat: jest.fn().mockResolvedValue({
        id: 'title-1',
        content: 'Risk Management for Forex Intraday',
        finishReason: 'stop',
      }),
      completeChatStream: jest.fn(),
    } as any);
  });

  describe('getRecentMessages', () => {
    it('returns the last N messages in chronological order', async () => {
      // Simulate 15 messages: createdAt 1..15 (oldest to newest)
      const allMessages = Array.from({ length: 15 }, (_, i) => ({
        id: `msg-${i + 1}`,
        sessionId: 'session-1',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
        createdAt: new Date(1000 + i),
        updatedAt: new Date(1000 + i),
      }));

      // Store returns DESC order (newest first), so limit 12 gives messages 15,14,...,4
      const descSlice = [...allMessages].reverse().slice(0, 12);
      MockChatMessage.findAll.mockResolvedValue(descSlice as any);

      const result = await store.getRecentMessages('session-1', 12);

      expect(MockChatMessage.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-1' },
          order: [['createdAt', 'DESC']],
          limit: 12,
        })
      );

      // Result must be chronological (oldest of the window first): messages 4,5,...,15
      expect(result).toHaveLength(12);
      expect(result[0].content).toBe('Message 4');
      expect(result[11].content).toBe('Message 15');
    });
  });

  describe('getOrCreateConversation', () => {
    it('creates a new session with generated title when firstMessage is provided', async () => {
      MockChatSession.create.mockResolvedValue({
        id: 'session-new',
        userId: 'user-1',
        title: 'Risk Management for Forex Intraday',
        context: null,
      } as any);

      const session = await store.getOrCreateConversation('user-1', undefined, {
        firstMessage:
          'What is the best risk management strategy for forex intraday trading?',
      });

      expect(MockChatSession.create).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Risk Management for Forex Intraday',
        context: null,
      });
      expect(session.id).toBe('session-new');
      expect(session.title).toBe('Risk Management for Forex Intraday');
    });

    it('returns existing session without creating', async () => {
      MockChatSession.findOne.mockResolvedValue({
        id: 'existing',
        userId: 'user-1',
        title: 'Old title',
        context: null,
      } as any);

      const session = await store.getOrCreateConversation('user-1', 'existing', {
        firstMessage: 'A new message',
      });

      expect(MockChatSession.create).not.toHaveBeenCalled();
      expect(session.title).toBe('Old title');
    });
  });
});
