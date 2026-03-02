import { journalService } from '../journal/journalService.js';
import { promptBuilder } from './promptBuilder.js';
import { groqCompoundClient, type GroqMessage } from './groqCompoundClient.js';
import { conversationStore } from './conversationStore.js';
import { trimHistoryToTokenBudget } from './conversationTokenHelper.js';
import { env } from '../../config/env.js';
import type { CoachingIntent, JournalContextForLLM } from '../journal/journalTypes.js';
import { logger } from '../../config/logger.js';

/**
 * Configuration for coaching intent to analysis window mapping.
 */
const COACHING_WINDOW_CONFIG: Record<CoachingIntent, { days?: number; maxTrades?: number }> = {
  overview: { days: 90, maxTrades: 200 },
  recent_performance: { days: 30, maxTrades: 100 },
  pattern_detection: { days: undefined, maxTrades: 100 },
  risk_discipline: { days: 60, maxTrades: 150 },
  emotional_control: { days: 30, maxTrades: 100 },
};

/**
 * Response structure for journal coaching.
 */
export interface AiResponse {
  message: string;
  responseId?: string;
  metadata?: {
    coachingIntent?: CoachingIntent;
    tradeCount?: number;
    windowFrom?: Date;
    windowTo?: Date;
  };
}

/**
 * Parameters for journal coaching request.
 */
export interface JournalCoachingParams {
  userId: string;
  message: string;
  coachingIntent: CoachingIntent;
  conversationId?: string;
}

/**
 * Service for orchestrating journal coaching via LLM.
 * Handles coaching requests, builds journal context, and generates coaching responses.
 */
export class JournalCoach {
  /**
   * Handle a journal coaching request.
   * Maps coaching intent to analysis window, builds context, and generates coaching response.
   */
  async handleCoachingRequest(params: JournalCoachingParams): Promise<AiResponse> {
    const { userId, message, coachingIntent, conversationId } = params;

    try {
      // Map coaching intent to analysis window
      const windowConfig = COACHING_WINDOW_CONFIG[coachingIntent];
      const now = new Date();
      const windowTo = now;
      const windowFrom = windowConfig.days
        ? new Date(now.getTime() - windowConfig.days * 24 * 60 * 60 * 1000)
        : undefined;

      // Build journal context
      logger.debug('Building journal context for coaching', {
        userId,
        coachingIntent,
        windowFrom,
        windowTo,
        maxTrades: windowConfig.maxTrades,
      });

      const journalContext = await journalService.buildJournalContext({
        userId,
        from: windowFrom,
        to: windowTo,
        maxTrades: windowConfig.maxTrades,
        coachingIntent,
      });

      // Get conversation history if conversationId is provided (token-bounded)
      let conversationHistory: GroqMessage[] = [];
      if (conversationId) {
        const maxMessages = env.CONVERSATION_HISTORY_MAX_MESSAGES ?? 24;
        const coachingTokenBudget =
          env.CONVERSATION_HISTORY_MAX_TOKENS_COACHING ?? env.CONVERSATION_HISTORY_MAX_TOKENS ?? 4096;
        const raw = await conversationStore.getRecentMessages(conversationId, maxMessages);
        conversationHistory = trimHistoryToTokenBudget(raw, coachingTokenBudget);
      }

      // Build prompt
      const systemPrompt = promptBuilder.buildJournalPrompt({
        userMessage: message,
        conversationHistory,
        journalContext,
        coachingIntent,
      });

      // Build messages for Groq
      const messages = promptBuilder.buildMessages(systemPrompt, conversationHistory, message);

      // Call Groq Compound
      logger.debug('Calling Groq Compound for journal coaching', {
        userId,
        coachingIntent,
        tradeCount: journalContext.window.tradeCount,
      });

      const groqResponse = await groqCompoundClient.completeChat({
        messages,
        allowedTools: [], // No tools needed for coaching
        maxTokens: 2000,
        temperature: 0.7,
      });

      // Return structured response
      return {
        message: groqResponse.content,
        responseId: groqResponse.id,
        metadata: {
          coachingIntent,
          tradeCount: journalContext.window.tradeCount,
          windowFrom: journalContext.window.from,
          windowTo: journalContext.window.to,
        },
      };
    } catch (error) {
      logger.error('Journal coaching error', {
        error: (error as Error).message,
        userId,
        coachingIntent,
      });

      // Return safe error response
      return {
        message: `I encountered an issue analyzing your trading journal. Please try again or contact support if the problem persists.`,
        metadata: {
          coachingIntent,
        },
      };
    }
  }
}

// Export singleton instance
export const journalCoach = new JournalCoach();

/**
 * Legacy method for single-entry analysis (backward compatibility).
 * This is separate from the full journal coaching system.
 */
export const journalCoachLegacy = {
  async analyze(input: {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entry: number;
    exit?: number | null;
    notes?: string | null;
  }) {
    // Simple stub for single-entry analysis
    // TODO: Can be enhanced with LLM analysis of single entry
    const strengths = ['Good entry timing'];
    const mistakes = ['Early exit'];
    const tip = 'Consider holding until next key level, with a trailing stop.';

    return {
      score: 8,
      strengths,
      mistakes,
      tip,
    };
  },
};
