import { randomUUID } from 'crypto';
import { groqCompoundClient, type GroqMessage, type GroqChatResponse } from './groqCompoundClient';
import { getChatLLM } from './llm/chatLLM';
import { conversationStore } from './conversationStore';
import { trimHistoryToTokenBudget, estimateTokens } from './conversationTokenHelper';
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
import { contextCache, ContextCache } from '../cache/contextCache';
import { economicCalendarService } from '../economicCalendar/economicCalendarService';
import type { ChatCompletionOptions } from './llm/types';

export type ChatProgressStage =
  | 'context'
  | 'generating'
  | 'safety_check'
  | 'waiting_rate_limit';

export interface ChatRequest {
  userId: string;
  conversationId?: string;
  message: string;
  /** Resolved model id for chat completion (from plan allowlist). */
  modelId?: string;
  metadata?: {
    instrument?: string;
    timeframe?: string;
    chartId?: string;
    [key: string]: unknown;
  };
}

export interface ChatStreamCallbacks {
  /** `waiting_rate_limit` includes `detail.waitMs` when Groq returns 429 and we back off. */
  onProgress?: (stage: ChatProgressStage, detail?: { waitMs?: number }) => void;
  onChunk?: (text: string) => void;
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
  /** True when the safety guard replaced the model response with a fallback. */
  safety_fallback?: boolean;
}

/**
 * Main orchestration service that coordinates all chat components.
 * Handles intent detection, conversation continuity, prompt building, LLM calls, and safety checks.
 */
export class ChatOrchestrator {
  private shouldUseJsonOutputForTurn(
    intentResult: Awaited<ReturnType<typeof intentDetector.detectIntent>>
  ): boolean {
    // Never force JSON for smalltalk.
    if (
      intentResult.primaryIntent === 'smalltalk' ||
      intentResult.intents.some((i) => i.intent === 'smalltalk')
    ) {
      return false;
    }

    // JSON helps parsing for longer-form educational/analysis style replies, but it's overkill for short clarifications.
    if (intentResult.primaryIntent === 'clarification') {
      return false;
    }

    return true;
  }

  private rateLimitChatOptions(
    streamCallbacks?: ChatStreamCallbacks
  ): Pick<ChatCompletionOptions, 'onRateLimitRetry'> {
    return {
      onRateLimitRetry: (info) => {
        streamCallbacks?.onProgress?.('waiting_rate_limit', { waitMs: info.waitMs });
      },
    };
  }

  private shouldIncludeEconomicCalendar(
    intentResult: Awaited<ReturnType<typeof intentDetector.detectIntent>>,
    message: string
  ): boolean {
    // Never include calendar for smalltalk.
    if (intentResult.primaryIntent === 'smalltalk') return false;

    // Calendar is only useful when user is asking about markets, analysis, validation, or education around events.
    const intents = intentResult.intents.map((i) => i.intent);
    const hasRelevantIntent = intents.some(
      (i) => i === 'analysis' || i === 'validation' || i === 'education' || i === 'risk_evaluation'
    );
    if (!hasRelevantIntent) return false;

    // Require some market-ish cue in the message to avoid injecting events into generic education.
    return this.messageContainsMarketReference(message);
  }

  private async completeChatWithEmptyRetry(
    chatClient: ReturnType<typeof getChatLLM>,
    options: Parameters<ReturnType<typeof getChatLLM>['completeChat']>[0]
  ): Promise<Awaited<ReturnType<ReturnType<typeof getChatLLM>['completeChat']>>> {
    const first = await chatClient.completeChat(options);
    if (first.content && first.content.trim().length > 0) return first;

    logger.warn('LLM returned empty content, retrying once', {
      modelId: options.modelId,
      finishReason: first.finishReason,
      hasResponseFormat: !!options.responseFormat,
      messageCount: options.messages?.length,
      response: first,
    });

    // Retry once, removing responseFormat as some providers may emit non-content in strict JSON mode.
    const { responseFormat, ...rest } = options;
    const second = await chatClient.completeChat({ ...rest, responseFormat: undefined });
    return second;
  }
  /**
   * Process a chat message through the complete pipeline:
   * 1. Detect intent and user level
   * 2. Retrieve conversation history
   * 3. Build system prompt
   * 4. Call chat model provider
   * 5. Parse and structure response
   * 6. Apply safety checks
   * 7. Save messages and return response
   */
  async processMessage(
    request: ChatRequest,
    streamCallbacks?: ChatStreamCallbacks
  ): Promise<ChatResponse> {
    const { userId, conversationId, message, metadata, modelId } = request;

    try {
      // Step 1: Get or create conversation (new sessions get title from first message at create time)
      const session = await conversationStore.getOrCreateConversation(userId, conversationId, {
        firstMessage: message,
      });

      // Step 2: Retrieve and trim conversation history (token-bounded, optional summarization)
      const { conversationHistory, systemPromptPrefix } =
        await this.buildConversationContextForTurn(session.id);

      // Step 3: Detect intent and user level
      const intentResult = await intentDetector.detectIntent(
        message,
        session.id,
        conversationHistory,
        metadata,
        modelId
      );
      logger.info('Intent result', { intentResult: intentResult, message: message });

      // Smalltalk: lightweight path (no context fetch, no JSON forcing, no calendar)
      if (intentResult.primaryIntent === 'smalltalk') {
        const systemPrompt = promptBuilder.buildSystemPrompt({
          userLevel: intentResult.user_level,
          intents: intentResult.intents.map((i) => i.intent),
          primaryIntent: intentResult.primaryIntent,
          marketContext: undefined,
          riskContext: null,
          chartContext: null,
          sentimentContext: null,
          economicCalendarContext: null,
          useJsonOutput: false,
        });

        const messages = promptBuilder.buildMessages(systemPrompt, conversationHistory, message);

        await conversationStore.saveMessage(session.id, 'user', message);

        const chatClient = getChatLLM(modelId);
        const llmResponse = await this.completeChatWithEmptyRetry(chatClient, {
          messages,
          modelId,
          allowedTools: [],
          maxTokens: 400,
          temperature: 0.7,
          responseFormat: undefined,
          ...this.rateLimitChatOptions(streamCallbacks),
        });

        const responseContent = llmResponse.content?.trim() || 'Hi! How can I help?';
        await conversationStore.saveMessage(session.id, 'assistant', responseContent);

        const sections = this.parseStructuredResponse(responseContent);
        return {
          conversationId: session.id,
          message: responseContent,
          sections,
          intents: intentResult.intents.map((i) => i.intent),
          primaryIntent: intentResult.primaryIntent,
          user_level: intentResult.user_level,
          low_confidence: false,
          response_id: llmResponse.id,
          safety_fallback: false,
        };
      }

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
          safety_fallback: false,
        };
      }

      // Step 4: Build context in parallel where possible.
      // Batch 1: market + chart (independent); symbol extraction for sentiment if needed.
      // Batch 2 (after market): risk + sentiment (risk needs market; sentiment needs symbol from batch 1 or metadata).
      const needsMarketContext =
        intentResult.intents.some(
          (item) =>
            item.intent === 'analysis' ||
            item.intent === 'validation' ||
            item.intent === 'risk_evaluation'
        ) ||
        !!metadata?.instrument ||
        this.messageContainsMarketReference(message);
      const needChart = intentResult.isChartRelated || !!metadata?.chartId;
      const needSentimentSymbol = intentResult.isSentimentRelated && !metadata?.instrument;

      streamCallbacks?.onProgress?.('context');

      const [marketContext, chartContextResult, sentimentSymbolExtracted] = await Promise.all([
        needsMarketContext
          ? this.getMarketContext(
              message,
              metadata,
              needsMarketContext ? intentResult.intents.map((i) => i.intent) : []
            )
          : Promise.resolve(undefined),
        needChart
          ? this.buildChartContext(userId, message, metadata, session.id)
          : Promise.resolve(null),
        needSentimentSymbol
          ? marketContextIntentExtractor
              .extractContextRequest(message, {} as any)
              .then((ex) => ex?.symbol)
              .catch(() => undefined)
          : Promise.resolve(undefined),
      ]);

      const chartContext = chartContextResult;
      const sentimentSymbol =
        (metadata?.instrument as string | undefined) ?? sentimentSymbolExtracted;

      // Batch 2: risk (needs marketContext) and sentiment (needs symbol)
      let riskContext: RiskContextForLLM | null = null;
      let correlationId: string | null = null;
      let sentimentContext: SentimentContextForLLM | null = null;

      const [riskContextResult, sentimentContextResult] = await Promise.all([
        intentResult.isRiskRelated
          ? (async () => {
              correlationId = randomUUID();
              logger.debug('Building risk context', {
                conversationId: session.id,
                correlationId,
                userId,
              });
              const rc = await riskOrchestrator.buildRiskContext(
                userId,
                message,
                conversationHistory,
                marketContext?.context
              );
              if (rc?.riskEvaluation) {
                logger.info('Risk evaluation completed', {
                  conversationId: session.id,
                  correlationId,
                  userId,
                  riskPerTradePct: rc.riskEvaluation.riskMetrics.riskPerTradePct,
                  policyFlagsCount: rc.riskEvaluation.policyFlags.length,
                });
              }
              return rc;
            })()
          : Promise.resolve(null),
        intentResult.isSentimentRelated && sentimentSymbol
          ? (async () => {
              const timeframeHint = metadata?.timeframe as string | undefined;
              const windowMinutes = getSentimentWindowMinutesFromRequest(
                message,
                timeframeHint,
                new Date()
              );
              const windowMinutesNum = windowMinutes ?? 1440;
              if (!ContextCache.shouldSkipCache(message, metadata)) {
                const cached = contextCache.getSentiment(sentimentSymbol, windowMinutesNum);
                if (cached) {
                  logger.debug('Sentiment context from cache', { symbol: sentimentSymbol });
                  return cached;
                }
              }
              logger.info('Building sentiment context', {
                conversationId: session.id,
                symbol: sentimentSymbol,
                userId,
                windowMinutes,
              });
              try {
                const sc = await sentimentService.buildSentimentContext({
                  symbol: sentimentSymbol,
                  windowMinutes,
                  timeframeHint,
                  userId,
                });
                if (!ContextCache.shouldSkipCache(message, metadata)) {
                  contextCache.setSentiment(sentimentSymbol, windowMinutesNum, sc);
                }
                logger.info('Sentiment context built', {
                  conversationId: session.id,
                  symbol: sentimentSymbol,
                  aggregateScore: sc.aggregate?.score,
                  direction: sc.aggregate?.direction,
                  signalsUsed: sc.aggregate?.signalsUsed,
                });
                return sc;
              } catch (err) {
                logger.warn('Failed to build sentiment context', {
                  error: (err as Error).message,
                  conversationId: session.id,
                });
                return null;
              }
            })()
          : Promise.resolve(null),
      ]);

      riskContext = riskContextResult;
      sentimentContext = sentimentContextResult;

      if (intentResult.isSentimentRelated && !sentimentSymbol) {
        logger.warn('Could not resolve symbol for sentiment query', {
          conversationId: session.id,
          message: message.substring(0, 100),
        });
      }

      // Step 4.8: Economic calendar context (next 7 days; optional FX country filter)
      let economicCalendarContext = null;
      try {
        const includeCalendar = this.shouldIncludeEconomicCalendar(intentResult, message);
        if (!includeCalendar) {
          economicCalendarContext = null;
        } else {
          const now = new Date();
          const to = new Date(now.getTime() + 7 * 86400000);
          let countryCodes: string[] | undefined;
          if (marketContext?.context?.instrument?.assetClass === 'FX') {
            const base = marketContext.context.instrument.base;
            const quote = marketContext.context.instrument.quote;
            const currencyToCountry: Record<string, string> = {
              USD: 'US',
              EUR: 'EU',
              GBP: 'UK',
              JPY: 'JP',
              CHF: 'CH',
              AUD: 'AU',
              CAD: 'CA',
              NZD: 'NZ',
            };
            const codes: string[] = [];
            if (base && currencyToCountry[base]) codes.push(currencyToCountry[base]);
            if (quote && currencyToCountry[quote]) codes.push(currencyToCountry[quote]);
            if (codes.length) countryCodes = [...new Set(codes)];
          }
          economicCalendarContext = await economicCalendarService.getEventsForChat({
            from: now,
            to,
            countryCodes,
            limit: 50,
          });
        }
      } catch (err) {
        logger.warn('Failed to get economic calendar context', {
          error: (err as Error).message,
          conversationId: session.id,
        });
      }

      // Step 5: Build system prompt (with optional conversation summary prefix)
      const hasRiskIntentForPrompt = intentResult.intents.some((i) =>
        ['risk_evaluation', 'position_sizing', 'risk_policy_explanation'].includes(i.intent)
      );
      const hasChartIntentForPrompt = intentResult.intents.some(
        (i) => i.intent === 'chart_analysis'
      );
      const hasSentimentIntentForPrompt = intentResult.intents.some(
        (i) => i.intent === 'sentiment_snapshot'
      );
      const useJsonOutput =
        this.shouldUseJsonOutputForTurn(intentResult) &&
        !(riskContext && hasRiskIntentForPrompt) &&
        !(chartContext && hasChartIntentForPrompt) &&
        !(sentimentContext && hasSentimentIntentForPrompt);

      let systemPrompt = promptBuilder.buildSystemPrompt({
        userLevel: intentResult.user_level,
        intents: intentResult.intents.map((i) => i.intent),
        primaryIntent: intentResult.primaryIntent,
        marketContext: marketContext?.context,
        riskContext,
        chartContext,
        sentimentContext,
        economicCalendarContext,
        useJsonOutput,
      });
      if (systemPromptPrefix) {
        systemPrompt = systemPromptPrefix + systemPrompt;
      }

      // Step 6: Format messages for chat completion API
      const messages = promptBuilder.buildMessages(systemPrompt, conversationHistory, message);

      // Step 7: Save user message
      const userMessageRecord = await conversationStore.saveMessage(session.id, 'user', message);
      const userMessageId = userMessageRecord.id;

      // Step 8: Call chat model provider (streaming or one-shot; with 413 retry via summarized context)
      logger.debug('Calling chat model provider', {
        conversationId: session.id,
        intents: intentResult.intents
          .map((i) => `${i.intent}(${i.confidence.toFixed(2)})`)
          .join(', '),
        primaryIntent: intentResult.primaryIntent,
        userLevel: intentResult.user_level,
        messageLength: message.length,
        correlationId: correlationId || undefined,
      });

      streamCallbacks?.onProgress?.('generating');

      const chatClient = getChatLLM(modelId);
      let llmResponse: Awaited<ReturnType<typeof chatClient.completeChat>>;
      if (streamCallbacks?.onChunk) {
        // Buffer the model stream (no raw JSON/token deltas to the client); replay plain text after parse.
        llmResponse = await chatClient.completeChatStream(
          {
            messages,
            modelId,
            allowedTools: ['web_search', 'code_interpreter'],
            maxTokens: 2000,
            temperature: 0.7,
            responseFormat: useJsonOutput ? { type: 'json_object' } : undefined,
            ...this.rateLimitChatOptions(streamCallbacks),
          },
          { onChunk: () => {} }
        );
        if (!llmResponse.content?.trim()) {
          logger.warn('Streaming chat returned empty content; retrying non-stream once', {
            conversationId: session.id,
          });
          llmResponse = await this.completeChatWithEmptyRetry(chatClient, {
            messages,
            modelId,
            allowedTools: ['web_search', 'code_interpreter'],
            maxTokens: 2000,
            temperature: 0.7,
            responseFormat: useJsonOutput ? { type: 'json_object' } : undefined,
            ...this.rateLimitChatOptions(streamCallbacks),
          });
        }
      } else {
        try {
          llmResponse = await this.completeChatWithEmptyRetry(chatClient, {
            messages,
            modelId,
            allowedTools: ['web_search', 'code_interpreter'],
            maxTokens: 2000,
            temperature: 0.7,
            responseFormat: useJsonOutput ? { type: 'json_object' } : undefined,
            ...this.rateLimitChatOptions(streamCallbacks),
          });
        } catch (chatErr) {
          const err = chatErr as Error & { statusCode?: number };
          const is413 =
            err.statusCode === 413 ||
            (err.message &&
              (err.message.includes('413') || err.message.includes('Entity Too Large')));
          if (is413) {
            logger.info('Chat request too large (413), retrying with summarized context', {
              conversationId: session.id,
            });
            const retryResult = await this.retryWithSummarizedContext(
              systemPrompt,
              conversationHistory,
              message,
              modelId,
              streamCallbacks
            );
            llmResponse = {
              id: retryResult.id,
              content: retryResult.content,
              finishReason: 'stop',
              usage: retryResult.usage,
            };
          } else {
            throw chatErr;
          }
        }
      }

      let responseContent = llmResponse.content;
      if (!responseContent || responseContent.trim().length === 0) {
        logger.debug('No response content from LLM', { llmResponse });
        // Final safety net: never persist empty assistant messages.
        responseContent =
          'I didn’t generate a response that time. Could you rephrase your question?';
      }
      let safetyFallback = false;

      streamCallbacks?.onProgress?.('safety_check');

      // Step 9: Apply safety guardrails
      const safetyCheck = safetyGuard.checkResponse(responseContent);
      if (!safetyCheck.isSafe) {
        safetyFallback = true;
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

      // Step 10: Parse structured sections from response (JSON when requested, else regex)
      let sections: StructuredResponse;
      let lowConfidence: boolean;
      let usedJsonObjectSections = false;
      if (useJsonOutput) {
        const parsed = this.parseStructuredResponseFromJson(responseContent);
        if (parsed) {
          sections = parsed.sections;
          lowConfidence = parsed.low_confidence ?? this.detectLowConfidence(responseContent);
          usedJsonObjectSections = true;
        } else {
          sections = this.parseStructuredResponse(responseContent);
          lowConfidence = this.detectLowConfidence(responseContent);
        }
      } else {
        sections = this.parseStructuredResponse(responseContent);
        lowConfidence = this.detectLowConfidence(responseContent);
      }

      const messageForClientAndPersistence = usedJsonObjectSections
        ? this.formatStructuredSectionsAsPlainText(sections) || responseContent
        : responseContent;

      // Step 11: Stream to client (replay final plain text in chunks; raw model stream was buffered above)
      if (streamCallbacks?.onChunk && messageForClientAndPersistence.trim().length > 0) {
        await this.replayStreamContent(streamCallbacks.onChunk, messageForClientAndPersistence);
      }

      // Step 12: Save assistant message (plain text when JSON sections were used; avoids storing duplicate raw JSON)
      await conversationStore.saveMessage(session.id, 'assistant', messageForClientAndPersistence);

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
      const result: ChatResponse = {
        conversationId: session.id,
        message: messageForClientAndPersistence,
        sections,
        intents: intentResult.intents.map((i) => i.intent),
        primaryIntent: intentResult.primaryIntent,
        user_level: intentResult.user_level,
        low_confidence: lowConfidence,
        response_id: llmResponse.id,
        safety_fallback: safetyFallback,
      };
      return result;
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      const statusCode = err.statusCode;
      const isRequestTooLarge =
        statusCode === 413 ||
        (err.message && (err.message.includes('413') || err.message.includes('Entity Too Large')));

      if (isRequestTooLarge) {
        const friendlyMessage =
          'This conversation or message is too long for me to process. Please try starting a new chat or shortening your message.';
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
          safety_fallback: false,
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
    userMessage: string,
    modelId?: string,
    streamCallbacks?: ChatStreamCallbacks
  ): Promise<{ id: string; content: string; usage?: GroqChatResponse['usage'] }> {
    const MAX_CONTEXT_FOR_SUMMARY = 28000;

    const contextToSummarize =
      systemPrompt.length > MAX_CONTEXT_FOR_SUMMARY
        ? systemPrompt.slice(0, MAX_CONTEXT_FOR_SUMMARY) +
          '\n\n[... context truncated for summarization ...]'
        : systemPrompt;

    const summarizerInstruction = `You are a summarizer. Summarize the following context in under 400 words. Preserve: key numbers, sentiment direction and drivers, data quality flags, risk metrics, and any structured data. Output only the summary, no preamble or explanation.`;

    const summarizeMessages: GroqMessage[] = [
      { role: 'system', content: summarizerInstruction },
      { role: 'user', content: contextToSummarize },
    ];

    let summary: string;
    try {
      const chatClient = getChatLLM(modelId);
      const summarizeResponse = await chatClient.completeChat({
        messages: summarizeMessages,
        modelId,
        maxTokens: 600,
        temperature: 0.3,
        ...this.rateLimitChatOptions(streamCallbacks),
      });
      summary = summarizeResponse.content.trim();
    } catch (err) {
      logger.warn(
        'Summarize step failed (may also be too large), falling back to generic message',
        {
          error: (err as Error).message,
        }
      );
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

    const chatClient = getChatLLM(modelId);
    const llmResponse = await chatClient.completeChat({
      messages: retryMessages,
      modelId,
      maxTokens: 2000,
      temperature: 0.7,
      ...this.rateLimitChatOptions(streamCallbacks),
    });

    return {
      id: llmResponse.id,
      content: llmResponse.content,
      usage: llmResponse.usage,
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

    const tokenThreshold =
      env.CONVERSATION_SUMMARIZE_WHEN_TOKENS_OVER ?? Math.floor(maxTokens * 0.8);
    const totalTokens = trimmed.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const overTokenThreshold = totalTokens > tokenThreshold;

    if (trimmed.length <= summarizeWhenOver && !overTokenThreshold) {
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

    const chatClient = getChatLLM();
    const response = await chatClient.completeChat({
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
  private async buildChartContext(
    userId: string,
    message: string,
    metadata: ChatRequest['metadata'],
    sessionId: string
  ): Promise<ChartContextForLLM | null> {
    try {
      const chartAnalysisService = new ChartAnalysisService(new GroqChartVisionProvider());
      const chartContext = await chartAnalysisService.analyzeChart({
        source: metadata?.chartId ? 'upload' : 'external_link',
        chartId: metadata?.chartId as string | undefined,
        symbolHint: metadata?.instrument as string | undefined,
        timeframeHint: metadata?.timeframe as string | undefined,
        userId,
        rawQuery: message,
      });
      logger.debug('Chart context built', {
        conversationId: sessionId,
        chartId: chartContext.chartId,
        symbol: chartContext.symbol,
        patternsCount: chartContext.visionFeatures.patterns.length,
      });
      return chartContext;
    } catch (error) {
      logger.warn('Failed to build chart context', {
        error: (error as Error).message,
        conversationId: sessionId,
        chartId: metadata?.chartId,
      });
      return null;
    }
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

      // Optional: return cached market context when symbol is known and user didn't ask for "latest"
      if (metadata?.instrument && !ContextCache.shouldSkipCache(message, metadata)) {
        const cached = contextCache.getMarket(metadata.instrument, metadata.timeframe);
        if (cached !== undefined) {
          logger.debug('Market context from cache', { symbol: metadata.instrument });
          return {
            context: cached.context,
            available: cached.contextAvailable,
          };
        }
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
        if (!ContextCache.shouldSkipCache(message, metadata)) {
          contextCache.setMarket(result.context.instrument.symbol, request.timeframeHint, result);
        }
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
      'quote',
      'trading at',
      'how much',
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
    if (marketKeywords.some((keyword) => normalized.includes(keyword))) return true;
    // Common tickers / pairs when user doesn't say "price" (e.g. "What's BTC doing?")
    if (/\b(btc|eth|xrp|sol|bnb|eurusd|gbpusd|usdjpy|spy|qqq|aapl|msft)\b/i.test(message)) {
      return true;
    }
    return false;
  }

  /**
   * Human-readable single string for `message` and DB when the model returned JSON sections.
   * Clients should still prefer `sections` for structured UI (Facts / Interpretation / Risk).
   */
  private formatStructuredSectionsAsPlainText(sections: StructuredResponse): string {
    const blocks: string[] = [];
    if (sections.facts?.trim()) {
      blocks.push(`## Facts\n\n${sections.facts.trim()}`);
    }
    if (sections.interpretation?.trim()) {
      blocks.push(`## Interpretation\n\n${sections.interpretation.trim()}`);
    }
    if (sections.risk_and_uncertainty?.trim()) {
      blocks.push(`## Risk & uncertainty\n\n${sections.risk_and_uncertainty.trim()}`);
    }
    return blocks.join('\n\n');
  }

  /**
   * After the model stream is buffered and parsed, replay the final plain-text answer in small
   * chunks so SSE `content` events match what the user reads (not raw JSON token deltas).
   */
  private async replayStreamContent(
    onChunk: (text: string) => void,
    fullText: string
  ): Promise<void> {
    const chunkChars = 48;
    for (let i = 0; i < fullText.length; i += chunkChars) {
      onChunk(fullText.slice(i, i + chunkChars));
      if (i + chunkChars < fullText.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  /**
   * Try to parse response as JSON with facts, interpretation, risk_and_uncertainty.
   * Returns null if parse fails or required keys are missing.
   */
  private parseStructuredResponseFromJson(
    content: string
  ): { sections: StructuredResponse; low_confidence: boolean } | null {
    const trimmed = content.trim();
    let parsed: Record<string, unknown>;
    try {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace <= firstBrace) return null;
      parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (
      !parsed ||
      typeof parsed.facts !== 'string' ||
      typeof parsed.interpretation !== 'string' ||
      typeof parsed.risk_and_uncertainty !== 'string'
    ) {
      return null;
    }
    return {
      sections: {
        facts: String(parsed.facts).trim(),
        interpretation: String(parsed.interpretation).trim(),
        risk_and_uncertainty: String(parsed.risk_and_uncertainty).trim(),
      },
      low_confidence: parsed.low_confidence === true,
    };
  }

  /**
   * Parse structured response into Facts, Interpretation, and Risk & Uncertainty sections.
   * Handles various formats the model might use. When sections are missing, uses full content for interpretation.
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

    const facts = factsMatch ? factsMatch[1].trim() : '';
    const interpretation = interpretationMatch ? interpretationMatch[1].trim() : '';
    const risk_and_uncertainty = riskMatch ? riskMatch[1].trim() : '';

    // Fallback: when sections are missing, put full content into interpretation so UI shows something accurate
    const fullContent = content.trim();
    const defaultFacts = facts || 'Market information and context.';
    const defaultInterpretation =
      interpretation || fullContent || 'Analysis and interpretation of the available information.';
    const defaultRisk =
      risk_and_uncertainty ||
      'Consider the inherent risks and uncertainties in trading. Markets are unpredictable, and no strategy guarantees success.';

    return {
      facts: defaultFacts,
      interpretation: defaultInterpretation,
      risk_and_uncertainty: defaultRisk,
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
