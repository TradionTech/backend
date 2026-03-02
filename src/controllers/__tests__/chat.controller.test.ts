import { Request, Response } from 'express';
import { chatController } from '../chat.controller';
import { Usage } from '../../services/usage/usage';
import { Limits } from '../../services/plans/limits';
import { chatOrchestrator } from '../../services/ai/chatOrchestrator';

jest.mock('../../services/usage/usage');
jest.mock('../../services/plans/limits');
jest.mock('../../services/ai/chatOrchestrator');

const mockedUsage = Usage as jest.Mocked<typeof Usage>;
const mockedOrchestrator = chatOrchestrator as jest.Mocked<typeof chatOrchestrator>;

describe('ChatController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      body: {},
      auth: { userId: 'user-123' },
    } as any;

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;

    jest.clearAllMocks();
  });

  describe('postChat', () => {
    it('should process educational query and return structured response', async () => {
      mockReq.body = {
        message: 'What is a stop loss?',
      };

      mockedUsage.ensureDailyRow.mockResolvedValueOnce(undefined);
      mockedUsage.getPlan.mockResolvedValueOnce('free');
      mockedUsage.getCounters.mockResolvedValueOnce({ chatToday: 5 });
      mockedOrchestrator.processMessage.mockResolvedValueOnce({
        conversationId: 'session-123',
        message: 'A stop loss is...',
        sections: {
          facts: 'A stop loss is an order type...',
          interpretation: 'It helps manage risk by...',
          risk_and_uncertainty: 'No strategy guarantees...',
        },
        intent: 'education',
        user_level: 'novice',
        low_confidence: false,
        response_id: 'resp-123',
      });
      mockedUsage.inc.mockResolvedValueOnce(undefined);

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        conversation_id: 'session-123',
        response_id: 'resp-123',
        message: 'A stop loss is...',
        sections: {
          facts: 'A stop loss is an order type...',
          interpretation: 'It helps manage risk by...',
          risk_and_uncertainty: 'No strategy guarantees...',
        },
        intent: 'education',
        user_level: 'novice',
        low_confidence: false,
      });
    });

    it('should enforce free plan limits', async () => {
      mockReq.body = {
        message: 'Test message',
      };

      mockedUsage.ensureDailyRow.mockResolvedValueOnce(undefined);
      mockedUsage.getPlan.mockResolvedValueOnce('free');
      mockedUsage.getCounters.mockResolvedValueOnce({
        chatToday: Limits.free.maxChatPerDay,
      });

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Free plan daily chat limit reached. Upgrade to Pro.',
      });
      expect(mockedOrchestrator.processMessage).not.toHaveBeenCalled();
    });

    it('should handle reckless query and apply safety guardrails', async () => {
      mockReq.body = {
        message: 'Should I go all-in on Bitcoin?',
      };

      mockedUsage.ensureDailyRow.mockResolvedValueOnce(undefined);
      mockedUsage.getPlan.mockResolvedValueOnce('pro');
      mockedUsage.getCounters.mockResolvedValueOnce({ chatToday: 0 });
      mockedOrchestrator.processMessage.mockResolvedValueOnce({
        conversationId: 'session-123',
        message: "I can't encourage risky trading behavior...",
        sections: {
          facts: 'Trading involves risk...',
          interpretation: 'Responsible trading requires...',
          risk_and_uncertainty: 'High-risk strategies can lead to losses...',
        },
        intent: 'validation',
        user_level: 'intermediate',
        low_confidence: false,
        response_id: 'resp-123',
      });
      mockedUsage.inc.mockResolvedValueOnce(undefined);

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("can't encourage"),
        })
      );
    });

    it('should handle ambiguous query and return low confidence', async () => {
      mockReq.body = {
        message: 'What will happen?',
      };

      mockedUsage.ensureDailyRow.mockResolvedValueOnce(undefined);
      mockedUsage.getPlan.mockResolvedValueOnce('free');
      mockedUsage.getCounters.mockResolvedValueOnce({ chatToday: 5 });
      mockedOrchestrator.processMessage.mockResolvedValueOnce({
        conversationId: 'session-123',
        message: 'I need more information to provide a useful answer...',
        sections: {
          facts: 'Limited information available...',
          interpretation: 'Without more context...',
          risk_and_uncertainty: 'Uncertainty is high...',
        },
        intent: 'clarification',
        user_level: 'intermediate',
        low_confidence: true,
        response_id: 'resp-123',
      });
      mockedUsage.inc.mockResolvedValueOnce(undefined);

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          low_confidence: true,
        })
      );
    });

    it('should validate message is not empty', async () => {
      mockReq.body = {
        message: '',
      };

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Message is required and cannot be empty',
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.body = {
        message: 'Test message',
      };

      mockedUsage.ensureDailyRow.mockResolvedValueOnce(undefined);
      mockedUsage.getPlan.mockResolvedValueOnce('free');
      mockedUsage.getCounters.mockResolvedValueOnce({ chatToday: 5 });
      mockedOrchestrator.processMessage.mockRejectedValueOnce(
        new Error('Orchestrator error')
      );

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to process chat message',
        })
      );
    });

    it('should support optional session_id and metadata', async () => {
      mockReq.body = {
        session_id: 'existing-session-123',
        message: 'Continue conversation',
        metadata: {
          instrument: 'BTCUSDT',
          timeframe: '1h',
        },
      };

      mockedUsage.ensureDailyRow.mockResolvedValueOnce(undefined);
      mockedUsage.getPlan.mockResolvedValueOnce('pro');
      mockedUsage.getCounters.mockResolvedValueOnce({ chatToday: 0 });
      mockedOrchestrator.processMessage.mockResolvedValueOnce({
        conversationId: 'existing-session-123',
        message: 'Response',
        sections: {
          facts: 'Facts',
          interpretation: 'Interpretation',
          risk_and_uncertainty: 'Risk',
        },
        intent: 'analysis',
        user_level: 'advanced',
        low_confidence: false,
        response_id: 'resp-123',
      });
      mockedUsage.inc.mockResolvedValueOnce(undefined);

      await chatController.postChat(mockReq as Request, mockRes as Response);

      expect(mockedOrchestrator.processMessage).toHaveBeenCalledWith({
        userId: 'user-123',
        conversationId: 'existing-session-123',
        message: 'Continue conversation',
        metadata: {
          instrument: 'BTCUSDT',
          timeframe: '1h',
        },
      });
    });
  });
});
