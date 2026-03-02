import { randomUUID } from 'crypto';
import { groqCompoundClient, type GroqMessage, type GroqChatResponse } from './groqCompoundClient';
import { conversationStore } from './conversationStore';
import { trimHistoryToTokenBudget } from './conversationTokenHelper';
import { env } from '../../config/env';
import { intentDetector } from './intentDetector';
import { promptBuilder, type UserLevel, type Intent } from './promptBuilder';
import { safetyGuard } from './safetyGuard';
import { marketContextService } from '../market/marketContextService';
import { riskOrchestrator, type RiskContextForLLM } from '../risk/riskOrchestrator';
import { RiskCalculation } from '../../db/models/RiskCalculation';
import { ChartAnalysisService } from '../chart/chartAnalysisService';
import { GroqChartVisionProvider } from '../chart/providers/groqChartVisionProvider';
import type { ChartContextForLLM } from '../chart/chartTypes';
import { journalCoach } from './journalCoach';
import { sentimentService } from '../sentiment/sentimentService';
import { getSentimentWindowMinutesFromRequest } from '../sentiment/sentimentWindowFromMessage';
import type { SentimentContextForLLM } from '../sentiment/sentimentTypes';
import { marketContextIntentExtractor } from '../market/marketContextIntentExtractor';
import { logger } from '../../config/logger';

export interface ChatRequest {
  userId: string;
  conversationId?: string;
  message: string;
  metadata?: {
    instrument?: string;
    timeframe?: string;
    chartId?: string;
    [key: string]: unknown;
  };
}

export interface StructuredResponse {
  facts: string;
  interpretation: string;
  risk_and_uncertainty: string;
}

export interface ChatResponse {
  conversationId: string;
  message: string; // Full response text
  sections: StructuredResponse;
  intents: Intent[]; // All detected intents
  primaryIntent: Intent; // For backward compatibility
  user_level: UserLevel;
  low_confidence: boolean;
  response_id: string;
}

/**
 * Main orchestration service that coordinates all chat components.
 * Handles intent detection, conversation continuity, prompt building, LLM calls, and safety checks.
 */
export class ChatOrchestrator {
  /**
   * Process a chat message through the complete pipeline:
   * 1. Detect intent and user level
   * 2. Retrieve conversation history
   * 3. Build system prompt
   * 4. Call Groq Compound
   * 5. Parse and structure response
   * 6. Apply safety checks
   * 7. Save messages and return response
   */
  async processMessage(request: ChatRequest): Promise<ChatResponse> {
    const { userId, conversationId, message, metadata } = request;

    try {
      // Step 1: Get or create conversation
      const session = await conversationStore.getOrCreateConversation(userId, conversationId);

      // Step 2: Retrieve and trim conversation history (token-bounded, optional summarization)
      const { conversationHistory, systemPromptPrefix } =
        await this.buildConversationContextForTurn(session.id);

      // Step 3: Detect intent and user level
      const intentResult = await intentDetector.detectIntent(
        message,
        session.id,
        conversationHistory,
        metadata
      );
      logger.info('Intent result', { intentResult: intentResult, message: message });

      // Step 3.5: Handle journal coaching requests (bypass normal chat flow)
      if (intentResult.isJournalRelated && intentResult.coachingIntent) {
        logger.info('Routing to journal coach', {
          conversationId: session.id,
          coachingIntent: intentResult.coachingIntent,
        });

        const coachingResponse = await journalCoach.handleCoachingRequest({
          userId,
          message,
          coachingIntent: intentResult.coachingIntent,
          conversationId: session.id,
        });

        logger.info('Coaching response', { coachingResponse: coachingResponse });

        // Save user message
        await conversationStore.saveMessage(session.id, 'user', message);

        // Save assistant message
        await conversationStore.saveMessage(session.id, 'assistant', coachingResponse.message);

        // Parse structured sections (reuse existing parser)
        const sections = this.parseStructuredResponse(coachingResponse.message);

        // Return response in ChatResponse format
        return {
          conversationId: session.id,
          message: coachingResponse.message,
          sections,
          intents: intentResult.intents.map((i) => i.intent),
          primaryIntent: intentResult.primaryIntent,
          user_level: intentResult.user_level,
          low_confidence: false, // Journal coaching is typically high confidence
          response_id: coachingResponse.responseId || `journal_${Date.now()}`,
        };
      }

      // Step 4: Get market context (for all messages, check if needed)
      // Check if ANY intent requires market context
      const needsMarketContext = intentResult.intents.some(
        (item) =>
          item.intent === 'analysis' ||
          item.intent === 'validation' ||
          item.intent === 'risk_evaluation'
      );
      const marketContext = await this.getMarketContext(
        message,
        metadata,
        needsMarketContext ? intentResult.intents.map((i) => i.intent) : []
      );

      // Step 4.5: If chart-related intent or chartId present, build chart context
      let chartContext: ChartContextForLLM | null = null;
      if (intentResult.isChartRelated || metadata?.chartId) {
        try {
          const chartAnalysisService = new ChartAnalysisService(new GroqChartVisionProvider());
          chartContext = await chartAnalysisService.analyzeChart({
            source: metadata?.chartId ? 'upload' : 'external_link',
            chartId: metadata?.chartId as string | undefined,
            symbolHint: metadata?.instrument as string | undefined,
            timeframeHint: metadata?.timeframe as string | undefined,
            userId,
            rawQuery: message,
          });

          logger.debug('Chart context built', {
            conversationId: session.id,
            chartId: chartContext.chartId,
            symbol: chartContext.symbol,
            patternsCount: chartContext.visionFeatures.patterns.length,
          });
        } catch (error) {
          logger.warn('Failed to build chart context', {
            error: (error as Error).message,
            conversationId: session.id,
            chartId: metadata?.chartId,
          });
          // Continue without chart context
        }
      }

      // Step 4.6: If risk-related intent, build risk context
      let riskContext: RiskContextForLLM | null = null;
      let correlationId: string | null = null;
      if (intentResult.isRiskRelated) {
        correlationId = randomUUID();
        logger.debug('Building risk context', {
          conversationId: session.id,
          correlationId,
          userId,
        });

        riskContext = await riskOrchestrator.buildRiskContext(
          userId,
          message,
          conversationHistory,
          marketContext?.context
        );

        // Log risk evaluation if available
        if (riskContext.riskEvaluation) {
          logger.info('Risk evaluation completed', {
            conversationId: session.id,
            correlationId,
            userId,
            riskPerTradePct: riskContext.riskEvaluation.riskMetrics.riskPerTradePct,
            policyFlagsCount: riskContext.riskEvaluation.policyFlags.length,
          });
        }
      }

      // Step 4.7: If sentiment-related intent, build sentiment context
      let sentimentContext: SentimentContextForLLM | null = null;
      if (intentResult.isSentimentRelated) {
        try {
          // Resolve symbol from metadata or extract from message
          let symbol: string | undefined = metadata?.instrument as string | undefined;
          let extracted: { symbol?: string; timeframeHint?: string } | undefined;

          if (!symbol) {
            // Try to extract symbol from message using market context extractor
            extracted = await marketContextIntentExtractor.extractContextRequest(
              message,
              {} as any
            );
            logger.info('marketContextIntentExtractor returned', { extracted });
            symbol = extracted.symbol;
          }

          if (symbol) {
            const timeframeHint =
              (metadata?.timeframe as string | undefined) ?? extracted?.timeframeHint;
            const windowMinutes = getSentimentWindowMinutesFromRequest(
              message,
              timeframeHint,
              new Date()
            );

            logger.info('Building sentiment context', {
              conversationId: session.id,
              symbol,
              userId,
              windowMinutes,
            });

            sentimentContext = await sentimentService.buildSentimentContext({
              symbol,
              windowMinutes,
              timeframeHint,
              userId,
            });

            logger.info('Sentiment context built', {
              conversationId: session.id,
              symbol,
              sentimentContext,
              aggregateScore: sentimentContext.aggregate?.score,
              direction: sentimentContext.aggregate?.direction,
              signalsUsed: sentimentContext.aggregate?.signalsUsed,
            });
          } else {
            logger.warn('Could not resolve symbol for sentiment query', {
              conversationId: session.id,
              message: message.substring(0, 100),
            });
          }
        } catch (error) {
          logger.warn('Failed to build sentiment context', {
            error: (error as Error).message,
            conversationId: session.id,
          });
          // Continue without sentiment context
        }
      }

      // Step 5: Build system prompt (with optional conversation summary prefix)
      let systemPrompt = promptBuilder.buildSystemPrompt({
        userLevel: intentResult.user_level,
        intents: intentResult.intents.map((i) => i.intent),
        primaryIntent: intentResult.primaryIntent,
        marketContext: marketContext?.context,
        riskContext,
        chartContext,
        sentimentContext,
      });
      if (systemPromptPrefix) {
        systemPrompt = systemPromptPrefix + systemPrompt;
      }

      // Step 6: Format messages for Groq API
      const messages = promptBuilder.buildMessages(systemPrompt, conversationHistory, message);

      // Step 7: Save user message
      const userMessageRecord = await conversationStore.saveMessage(session.id, 'user', message);
      const userMessageId = userMessageRecord.id;

      // Step 8: Call Groq Compound (with 413 retry via summarized context)
      logger.debug('Calling Groq Compound', {
        conversationId: session.id,
        intents: intentResult.intents
          .map((i) => `${i.intent}(${i.confidence.toFixed(2)})`)
          .join(', '),
        primaryIntent: intentResult.primaryIntent,
        userLevel: intentResult.user_level,
        messageLength: message.length,
        correlationId: correlationId || undefined,
      });

      let groqResponse: Awaited<ReturnType<typeof groqCompoundClient.completeChat>>;
      try {
        groqResponse = await groqCompoundClient.completeChat({
          messages,
          allowedTools: ['web_search', 'code_interpreter'],
          maxTokens: 2000,
          temperature: 0.7,
        });
      } catch (chatErr) {
        const err = chatErr as Error & { statusCode?: number };
        const is413 =
          err.statusCode === 413 ||
          (err.message && (err.message.includes('413') || err.message.includes('Entity Too Large')));
        if (is413) {
          logger.info('Chat request too large (413), retrying with summarized context', {
            conversationId: session.id,
          });
          const retryResult = await this.retryWithSummarizedContext(
            systemPrompt,
            conversationHistory,
            message
          );
          groqResponse = {
            id: retryResult.id,
            content: retryResult.content,
            finishReason: 'stop',
            usage: retryResult.usage,
          };
        } else {
          throw chatErr;
        }
      }

      let responseContent = groqResponse.content;

      // Step 9: Apply safety guardrails
      const safetyCheck = safetyGuard.checkResponse(responseContent);
      if (!safetyCheck.isSafe) {
        logger.warn('Safety guard triggered, using fallback', {
          conversationId: session.id,
          correlationId: correlationId || undefined,
          reason: safetyCheck.reason,
        });
        responseContent = safetyCheck.fallbackMessage || responseContent;
      }

      // Step 9.5: Ensure risk disclaimer for risk-related responses
      if (intentResult.isRiskRelated) {
        responseContent = safetyGuard.ensureRiskDisclaimer(responseContent, true);
      }

      // Step 10: Parse structured sections from response
      const sections = this.parseStructuredResponse(responseContent);

      // Step 11: Detect low confidence (heuristic: check for uncertainty indicators)
      const lowConfidence = this.detectLowConfidence(responseContent);

      // Step 12: Save assistant message
      await conversationStore.saveMessage(session.id, 'assistant', responseContent);

      // Step 12.5: Audit log risk evaluation if risk context exists
      if (riskContext && riskContext.riskEvaluation && correlationId) {
        try {
          // Sanitize risk evaluation request (remove sensitive data if any)
          const sanitizedParams = {
            userContext: {
              userId: riskContext.userContext.userId,
              riskProfile: riskContext.userContext.riskProfile,
              experienceLevel: riskContext.userContext.experienceLevel,
              // Don't log typical values as they're in profileMetrics
            },
            accountStateSummary: riskContext.accountStateSummary,
            tradeIntent: riskContext.riskEvaluation ? 'present' : 'missing', // Don't log full trade intent
            marketSnapshot: {
              symbol: riskContext.marketSnapshot.symbol,
              currentPrice: riskContext.marketSnapshot.currentPrice,
            },
          };

          await RiskCalculation.create({
            userId,
            chatSessionId: session.id,
            messageId: userMessageId,
            correlationId,
            params: sanitizedParams,
            result: riskContext.riskEvaluation,
          });

          logger.debug('Risk evaluation audited', {
            conversationId: session.id,
            correlationId,
            userId,
          });
        } catch (error) {
          logger.error('Failed to audit risk evaluation', {
            error: (error as Error).message,
            conversationId: session.id,
            correlationId,
            userId,
          });
          // Don't fail the request if audit logging fails
        }
      }

      // Step 13: Return structured response
      return {
        conversationId: session.id,
        message: responseContent,
        sections,
        intents: intentResult.intents.map((i) => i.intent),
        primaryIntent: intentResult.primaryIntent,
        user_level: intentResult.user_level,
        low_confidence: lowConfidence,
        response_id: groqResponse.id,
      };
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      const statusCode = err.statusCode;
      const isRequestTooLarge =
        statusCode === 413 ||
        (err.message && (err.message.includes('413') || err.message.includes('Entity Too Large')));

      if (isRequestTooLarge) {
        const friendlyMessage =
          "This conversation or message is too long for me to process. Please try starting a new chat or shortening your message.";
        const sid = conversationId ?? '';
        logger.warn('Chat request too large (413), returning friendly fallback', {
          conversationId: sid,
          userId,
        });
        if (sid) {
          try {
            await conversationStore.saveMessage(sid, 'assistant', friendlyMessage);
          } catch (saveErr) {
            logger.warn('Failed to save 413 fallback message', {
              error: (saveErr as Error).message,
              conversationId: sid,
            });
          }
        }
        return {
          conversationId: sid || 'unknown',
          message: friendlyMessage,
          sections: {
            facts: '',
            interpretation: '',
            risk_and_uncertainty: '',
          },
          intents: ['education'],
          primaryIntent: 'education',
          user_level: 'novice',
          low_confidence: false,
          response_id: '413_fallback',
        };
      }

      logger.error('Chat orchestration error', {
        error: err.message,
        userId,
        conversationId,
      });

      throw new Error(`Failed to process chat message: ${err.message}`);
    }
  }

  /**
   * On 413 (payload too large), summarize the system prompt in a first LLM call,
   * then retry the main chat with the condensed context so the payload fits.
   */
  private async retryWithSummarizedContext(
    systemPrompt: string,
    conversationHistory: GroqMessage[],
    userMessage: string
  ): Promise<{ id: string; content: string; usage?: GroqChatResponse['usage'] }> {
    const MAX_CONTEXT_FOR_SUMMARY = 28000;

    const contextToSummarize =
      systemPrompt.length > MAX_CONTEXT_FOR_SUMMARY
        ? systemPrompt.slice(0, MAX_CONTEXT_FOR_SUMMARY) + '\n\n[... context truncated for summarization ...]'
        : systemPrompt;

    const summarizerInstruction = `You are a summarizer. Summarize the following context in under 400 words. Preserve: key numbers, sentiment direction and drivers, data quality flags, risk metrics, and any structured data. Output only the summary, no preamble or explanation.`;

    const summarizeMessages: GroqMessage[] = [
      { role: 'system', content: summarizerInstruction },
      { role: 'user', content: contextToSummarize },
    ];

    let summary: string;
    try {
      const summarizeResponse = await groqCompoundClient.completeChat({
        messages: summarizeMessages,
        maxTokens: 600,
        temperature: 0.3,
      });
      summary = summarizeResponse.content.trim();
    } catch (err) {
      logger.warn('Summarize step failed (may also be too large), falling back to generic message', {
        error: (err as Error).message,
      });
      throw err;
    }

    const condensedSystemPrompt = `You are TradionAI. The full context for this conversation was too long to send. Use the following condensed context to answer the user. Preserve key numbers and data quality caveats when you mention them.

CRITICAL: Do not give personalized trade advice, specific entry/exit prices, or guaranteed predictions. Keep the response educational.

CONDENSED CONTEXT:
${summary}

Respond to the user's message using the condensed context above. If the context mentions sentiment, risk, or market data, use that information. Acknowledge if information may be incomplete due to condensation.`;

    const retryMessages: GroqMessage[] = [
      { role: 'system', content: condensedSystemPrompt },
      ...conversationHistory.filter((m) => m.role !== 'system'),
      { role: 'user', content: userMessage },
    ];

    const groqResponse = await groqCompoundClient.completeChat({
      messages: retryMessages,
      maxTokens: 2000,
      temperature: 0.7,
    });

    return {
      id: groqResponse.id,
      content: groqResponse.content,
      usage: groqResponse.usage,
    };
  }

  /**
   * Build conversation context for this turn: fetch recent messages, trim to token budget,
   * and optionally summarize older part when message count exceeds threshold.
   */
  private async buildConversationContextForTurn(
    sessionId: string
  ): Promise<{ conversationHistory: GroqMessage[]; systemPromptPrefix: string }> {
    const maxMessages = env.CONVERSATION_HISTORY_MAX_MESSAGES ?? 24;
    const maxTokens = env.CONVERSATION_HISTORY_MAX_TOKENS ?? 4096;
    const summarizeWhenOver = env.CONVERSATION_SUMMARIZE_WHEN_MESSAGES_OVER ?? 8;
    const lastKFull = env.CONVERSATION_LAST_K_FULL_MESSAGES ?? 4;

    const raw = await conversationStore.getRecentMessages(sessionId, maxMessages);
    const eligible = raw.filter((m) => m.role === 'user' || m.role === 'assistant');
    const trimmed = trimHistoryToTokenBudget(eligible, maxTokens);

    if (trimmed.length <= summarizeWhenOver) {
      return { conversationHistory: trimmed, systemPromptPrefix: '' };
    }

    const olderPart = trimmed.slice(0, -lastKFull);
    const lastK = trimmed.slice(-lastKFull);

    let summary: string;
    try {
      summary = await this.summarizeConversation(olderPart);
    } catch (err) {
      logger.warn('Conversation summarization failed, using last K messages only', {
        error: (err as Error).message,
        sessionId,
      });
      return { conversationHistory: lastK, systemPromptPrefix: '' };
    }

    const systemPromptPrefix = `CONVERSATION SUMMARY:\n${summary}\n\n`;
    return { conversationHistory: lastK, systemPromptPrefix };
  }

  /**
   * Summarize a list of messages (user/assistant) into a short paragraph.
   */
  private async summarizeConversation(messages: GroqMessage[]): Promise<string> {
    const formatted = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const instruction = `Summarize this conversation in under 300 words. Preserve: topics discussed, key numbers, decisions, and open questions. Output only the summary.`;

    const response = await groqCompoundClient.completeChat({
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: formatted },
      ],
      maxTokens: 400,
      temperature: 0.3,
    });

    return response.content.trim();
  }

  /**
   * Get market context for the message.
   *
   * Checks if market context is needed (message contains symbol/timeframe or any intent requires market context),
   * then calls MarketContextService to fetch structured context.
   *
   * Returns undefined if context is not available or not needed.
   */
  private async getMarketContext(
    message: string,
    metadata?: ChatRequest['metadata'],
    intents?: Intent[]
  ): Promise<{ context?: any; available: boolean } | undefined> {
    try {
      // Check if market context is likely needed
      const marketRelatedIntents = ['analysis', 'validation', 'risk_evaluation'];
      const hasMarketRelatedIntent = intents?.some((intent) =>
        marketRelatedIntents.includes(intent)
      );

      const needsContext =
        metadata?.instrument ||
        metadata?.timeframe ||
        hasMarketRelatedIntent ||
        this.messageContainsMarketReference(message);

      if (!needsContext) {
        return undefined;
      }

      // Build market context request
      const request = {
        userId: undefined, // Can be added if needed
        symbol: metadata?.instrument,
        timeframeHint: metadata?.timeframe,
        rawQuery: message,
      };

      // Get context from service
      const result = await marketContextService.getContext(request);

      if (result.contextAvailable && result.context) {
        logger.debug('Market context retrieved', {
          symbol: result.context.instrument.symbol,
          assetClass: result.context.instrument.assetClass,
          isFresh: result.context.dataQuality.isFresh,
        });
        return {
          context: result.context,
          available: true,
        };
      } else {
        logger.debug('Market context not available', {
          reason: result.reason,
        });
        return {
          available: false,
        };
      }
    } catch (error) {
      logger.warn('Failed to get market context', {
        error: (error as Error).message,
      });
      // Don't fail the chat if context fetch fails
      return {
        available: false,
      };
    }
  }

  /**
   * Check if message likely contains market references (symbols, timeframes, etc.).
   * Simple heuristic to avoid unnecessary context fetches.
   */
  private messageContainsMarketReference(message: string): boolean {
    const marketKeywords = [
      'price',
      'chart',
      'candle',
      'trend',
      'volatility',
      'support',
      'resistance',
      'entry',
      'exit',
      'trade',
      'position',
      'scalp',
      'swing',
      'intraday',
      'timeframe',
      '1h',
      '4h',
      'daily',
      'weekly',
    ];

    const normalized = message.toLowerCase();
    return marketKeywords.some((keyword) => normalized.includes(keyword));
  }

  /**
   * Parse structured response into Facts, Interpretation, and Risk & Uncertainty sections.
   * Handles various formats the model might use.
   */
  private parseStructuredResponse(content: string): StructuredResponse {
    // Try to extract sections using common patterns
    const factsMatch =
      content.match(/\*\*Facts?\*\*:?\s*\n([\s\S]*?)(?=\*\*|$)/i) ||
      content.match(/Facts?:?\s*\n([\s\S]*?)(?=Interpretation|Risk|$)/i);
    const interpretationMatch =
      content.match(/\*\*Interpretation\*\*:?\s*\n([\s\S]*?)(?=\*\*|$)/i) ||
      content.match(/Interpretation:?\s*\n([\s\S]*?)(?=Risk|Uncertainty|$)/i);
    const riskMatch =
      content.match(/\*\*Risk\s*[&\s]*Uncertainty\*\*:?\s*\n([\s\S]*?)$/i) ||
      content.match(/Risk\s*[&\s]*Uncertainty:?\s*\n([\s\S]*?)$/i) ||
      content.match(/\*\*Risk\*\*:?\s*\n([\s\S]*?)$/i);

    const facts = factsMatch ? factsMatch[1].trim() : 'Market information and context.';
    const interpretation = interpretationMatch
      ? interpretationMatch[1].trim()
      : 'Analysis and interpretation of the available information.';
    const risk_and_uncertainty = riskMatch
      ? riskMatch[1].trim()
      : 'Consider the inherent risks and uncertainties in trading. Markets are unpredictable, and no strategy guarantees success.';

    return {
      facts,
      interpretation,
      risk_and_uncertainty,
    };
  }

  /**
   * Detect if the response indicates low confidence.
   * Heuristic: look for uncertainty indicators in the text.
   */
  private detectLowConfidence(content: string): boolean {
    const uncertaintyIndicators = [
      /uncertain/i,
      /unclear/i,
      /unknown/i,
      /missing/i,
      /incomplete/i,
      /limited information/i,
      /don't know/i,
      /cannot determine/i,
      /may not be accurate/i,
      /confidence is low/i,
      /not sure/i,
    ];

    const uncertaintyCount = uncertaintyIndicators.reduce((count, pattern) => {
      return count + (content.match(pattern)?.length || 0);
    }, 0);

    // If we see 3+ uncertainty indicators, mark as low confidence
    return uncertaintyCount >= 3;
  }
}

// Export singleton instance
export const chatOrchestrator = new ChatOrchestrator();
