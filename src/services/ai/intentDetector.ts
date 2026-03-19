import type { GroqMessage } from './groqCompoundClient';
import { conversationStore } from './conversationStore';
import { logger } from '../../config/logger';
import { getChatLLM } from './llm/chatLLM';

export type Intent =
  | 'smalltalk'
  | 'education'
  | 'analysis'
  | 'clarification'
  | 'validation'
  | 'risk_evaluation'
  | 'position_sizing'
  | 'risk_policy_explanation'
  | 'chart_analysis'
  | 'journal_coaching'
  | 'journal_overview'
  | 'journal_recent'
  | 'journal_pattern_detection'
  | 'sentiment_snapshot';

export interface IntentDetectionResult {
  intents: Array<{
    intent: Intent;
    confidence: number;
  }>;
  primaryIntent: Intent; // Highest confidence intent
  user_level: 'novice' | 'intermediate' | 'advanced';
  isRiskRelated: boolean; // True if ANY risk-related intent detected
  isChartRelated: boolean; // True if chart analysis intent detected or chartId present
  isJournalRelated: boolean; // True if ANY journal-related intent detected
  isSentimentRelated: boolean; // True if sentiment_snapshot intent detected
  coachingIntent?: import('../journal/journalTypes').CoachingIntent; // Mapped from journal intent
}

/**
 * Service for detecting user intent and experience level.
 * Uses Groq Compound for classification and caches user_level in session metadata.
 */
export class IntentDetector {
  private static readonly MAX_MESSAGE_LENGTH_FAST_PATH = 200;
  private static readonly MAX_MESSAGE_LENGTH_SMALLTALK = 80;
  private static readonly INTENT_CLASSIFIER_MAX_HISTORY = 5;

  private buildIntentClassifierPrompt(): string {
    return `You are an intent classifier for a trading education platform. Analyze the user's message and conversation context to determine:

1. ALL Intents detected in the message (array of intents with confidence scores):
   - smalltalk: Greetings, thanks, casual check-ins ("hello", "how are you", etc.) with no trading request
   - education: User wants to learn about trading concepts, strategies, or markets
   - analysis: User wants analysis of a specific market, instrument, or situation
   - clarification: User is asking for clarification on a previous response
   - validation: User wants validation or feedback on their trading idea/strategy
   - risk_evaluation: User is asking "Is this trade too risky?" or wants risk assessment of a specific trade
   - position_sizing: User is asking "How big should my position be?" or questions about position sizing
   - risk_policy_explanation: User is asking "Why is my risk limit X?" or questions about risk policy/limits
   - chart_analysis: User wants to analyze a trading chart image, asking about patterns, trends, or price action
   - journal_coaching: User wants coaching/feedback on their trading performance, asking "how am I doing", "review my trades", "coach me"
   - journal_overview: User wants an overview of their trading performance over a period
   - journal_recent: User wants analysis of their recent trading performance
   - journal_pattern_detection: User wants to identify patterns in their trading history
   - sentiment_snapshot: User is asking about market sentiment, mood, or asking "What's the sentiment on X?"

2. Primary Intent: The most prominent or highest confidence intent

3. User level (one of: novice, intermediate, advanced)

Respond with valid JSON in this exact format:
{
  "intents": [
    {"intent": "education", "confidence": 0.9},
    {"intent": "risk_evaluation", "confidence": 0.85}
  ],
  "primaryIntent": "education",
  "user_level": "novice"
}`;
  }

  private normalizeIntentResult(parsed: any): { intents: Array<{ intent: Intent; confidence: number }>; primaryIntent: Intent; user_level: 'novice' | 'intermediate' | 'advanced' } {
    // Backward compatibility: if old format (single intent), convert to new format
    if (parsed?.intent && !parsed?.intents) {
      parsed.intents = [{ intent: parsed.intent, confidence: parsed.confidence || 1.0 }];
      parsed.primaryIntent = parsed.intent;
    }

    const validIntents: Intent[] = [
      'smalltalk',
      'education',
      'analysis',
      'clarification',
      'validation',
      'risk_evaluation',
      'position_sizing',
      'risk_policy_explanation',
      'chart_analysis',
      'journal_coaching',
      'journal_overview',
      'journal_recent',
      'journal_pattern_detection',
      'sentiment_snapshot',
    ];
    const validLevels = ['novice', 'intermediate', 'advanced'] as const;

    const intents = (parsed?.intents || []).map((item: any) => ({
      intent: (validIntents.includes(item.intent) ? item.intent : 'education') as Intent,
      confidence:
        typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 1.0,
    }));

    if (intents.length === 0) {
      intents.push({ intent: 'education', confidence: 1.0 });
    }

    const primaryIntent: Intent =
      parsed?.primaryIntent && validIntents.includes(parsed.primaryIntent)
        ? (parsed.primaryIntent as Intent)
        : (intents.reduce(
            (prev: any, curr: any) => (curr.confidence > prev.confidence ? curr : prev),
            intents[0]
          ).intent as Intent);

    const user_level =
      validLevels.includes(parsed?.user_level) ? parsed.user_level : 'intermediate';

    return { intents, primaryIntent, user_level };
  }

  private async classifyIntentWithLLM(
    message: string,
    conversationHistory: GroqMessage[],
    modelId?: string
  ): Promise<{ intents: Array<{ intent: Intent; confidence: number }>; primaryIntent: Intent; user_level: 'novice' | 'intermediate' | 'advanced' }> {
    const systemPrompt = this.buildIntentClassifierPrompt();

    const historyContext =
      conversationHistory.length > 0
        ? `\n\nConversation history (last ${Math.min(
            IntentDetector.INTENT_CLASSIFIER_MAX_HISTORY,
            conversationHistory.length
          )} messages):\n${conversationHistory
            .slice(-IntentDetector.INTENT_CLASSIFIER_MAX_HISTORY)
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n')}`
        : '';

    const userMessage = `User message: ${message}${historyContext}\n\nClassify the intent and user level.`;

    const chatClient = getChatLLM(modelId);
    const response = await chatClient.completeChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      modelId,
      maxTokens: 200,
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
    });

    const content = response.content.trim();
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        logger.warn('Failed to parse intent detection JSON', { content });
        return {
          intents: [{ intent: 'education', confidence: 1.0 }],
          primaryIntent: 'education',
          user_level: 'intermediate',
        };
      }
    }

    return this.normalizeIntentResult(parsed);
  }

  /**
   * Check if message is casual smalltalk/greeting (rule-based heuristic).
   * This is intentionally conservative to avoid misclassifying trading questions.
   */
  private isSmalltalkByKeywords(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) return false;

    // Strip simple punctuation to catch "hello!" / "good morning," etc.
    const compact = normalized.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

    // If there are obvious market/trading words, do not treat as smalltalk.
    const tradingHints = [
      'price',
      'chart',
      'trade',
      'trading',
      'position',
      'buy',
      'sell',
      'entry',
      'exit',
      'stop',
      'leverage',
      'risk',
      'crypto',
      'bitcoin',
      'eth',
      'forex',
      'stocks',
      'news',
      'fed',
      'ppi',
      'cpi',
      'calendar',
      'event',
    ];
    if (tradingHints.some((k) => compact.includes(k))) return false;

    const smalltalkPhrases = [
      'hello',
      'hi',
      'hey',
      'good morning',
      'good afternoon',
      'good evening',
      'yo',
      'sup',
      'how are you',
      'hows it going',
      "how's it going",
      'whats up',
      "what's up",
      'thanks',
      'thank you',
      'thx',
      'ty',
      'ok',
      'okay',
      'alright',
      'cool',
    ];

    const shortEnough = compact.length <= IntentDetector.MAX_MESSAGE_LENGTH_SMALLTALK;
    return shortEnough && smalltalkPhrases.some((p) => compact === p || compact.startsWith(`${p} `));
  }

  /**
   * Build a result when we skip Groq (single clear intent from keywords + cached level).
   */
  private buildFastPathResult(
    singleIntent: Intent,
    cachedLevel: 'novice' | 'intermediate' | 'advanced',
    conversationId: string,
    isRisk: boolean,
    isChart: boolean,
    isJournal: boolean,
    isSentiment: boolean
  ): IntentDetectionResult {
    const coachingIntent =
      isJournal && this.isJournalIntent(singleIntent)
        ? this.mapJournalIntentToCoachingIntent(singleIntent)
        : undefined;
    return {
      intents: [{ intent: singleIntent, confidence: 0.95 }],
      primaryIntent: singleIntent,
      user_level: cachedLevel,
      isRiskRelated: isRisk,
      isChartRelated: isChart,
      isJournalRelated: isJournal,
      isSentimentRelated: isSentiment,
      coachingIntent,
    };
  }

  /**
   * Check if message contains chart-related keywords (rule-based heuristic).
   */
  private isChartRelatedByKeywords(message: string): boolean {
    const normalized = message.toLowerCase();

    const chartKeywords = [
      'chart',
      'this chart',
      'price action here',
      'analyze this chart',
      'what does this chart show',
      'chart analysis',
      'chart pattern',
      'price chart',
      'trading chart',
      'candlestick chart',
    ];

    return chartKeywords.some((keyword) => normalized.includes(keyword));
  }

  /**
   * Check if message contains journal-related keywords (rule-based heuristic).
   */
  private isJournalRelatedByKeywords(message: string): boolean {
    const normalized = message.toLowerCase();

    const journalKeywords = [
      'review my trading',
      'how am i doing',
      'what mistakes',
      'patterns in my trades',
      'my trading patterns',
      'analyze my trades',
      'journal',
      'trading journal',
      'log',
      'my trades over the last',
      'my performance',
      'trading performance',
      'my stats',
      'trading stats',
      'coach me',
      'coaching',
    ];

    return journalKeywords.some((keyword) => normalized.includes(keyword));
  }

  /**
   * Check if message contains sentiment-related keywords (rule-based heuristic).
   */
  private isSentimentRelatedByKeywords(message: string): boolean {
    const normalized = message.toLowerCase();

    const sentimentKeywords = [
      'sentiment',
      'market mood',
      'how are people feeling about',
      'bullish or bearish on',
      'bullish on',
      'bearish on',
      'market sentiment',
      'trading sentiment',
      'investor sentiment',
      "what's the sentiment",
      'how does sentiment look',
      'sentiment analysis',
      'sentiment on',
    ];

    return sentimentKeywords.some((keyword) => normalized.includes(keyword));
  }

  /**
   * Map journal intent to coaching intent.
   */
  private mapJournalIntentToCoachingIntent(
    intent: Intent
  ): import('../journal/journalTypes').CoachingIntent | undefined {
    const mapping: Record<string, import('../journal/journalTypes').CoachingIntent> = {
      journal_overview: 'overview',
      journal_recent: 'recent_performance',
      journal_pattern_detection: 'pattern_detection',
      journal_coaching: 'overview', // Default to overview
    };
    return mapping[intent] || 'overview';
  }

  /**
   * Check if message contains risk-related keywords (rule-based heuristic).
   * Used as a fast pre-check before LLM classification.
   */
  private isRiskRelatedByKeywords(message: string): boolean {
    const normalized = message.toLowerCase();

    // Risk evaluation keywords
    const riskEvaluationKeywords = [
      'too risky',
      'risk per trade',
      'risk assessment',
      'is this safe',
      'is this risky',
      'risk level',
      'risk analysis',
      'assess risk',
    ];

    // Position sizing keywords
    const positionSizingKeywords = [
      'position size',
      'how many lots',
      'how much to risk',
      'quantity',
      'lot size',
      'position sizing',
      'how big',
      'how much',
      'size my position',
    ];

    // Policy explanation keywords
    const policyExplanationKeywords = [
      'why is my limit',
      'risk limit',
      'risk policy',
      'why limit',
      'risk threshold',
      'policy limit',
    ];

    // General risk keywords
    const generalRiskKeywords = [
      'leverage',
      'stop loss',
      'risk management',
      'drawdown',
      'max risk',
      'risk tolerance',
      'risk reward',
      'risk/reward',
      'rr ratio',
    ];

    const allKeywords = [
      ...riskEvaluationKeywords,
      ...positionSizingKeywords,
      ...policyExplanationKeywords,
      ...generalRiskKeywords,
    ];

    return allKeywords.some((keyword) => normalized.includes(keyword));
  }

  /**
   * Detect intent and user level for a message.
   * Checks session metadata first for cached user_level to avoid repeated calls.
   * Falls back to Groq classification if needed.
   */
  async detectIntent(
    message: string,
    conversationId: string,
    conversationHistory: GroqMessage[] = [],
    metadata?: { chartId?: string; [key: string]: unknown },
    modelId?: string
  ): Promise<IntentDetectionResult> {
    try {
      const isSmalltalk = this.isSmalltalkByKeywords(message);

      // Fast pre-check: rule-based keyword detection
      const isRiskRelated = this.isRiskRelatedByKeywords(message);
      const isChartRelated = this.isChartRelatedByKeywords(message) || !!metadata?.chartId;
      const isJournalRelated = this.isJournalRelatedByKeywords(message);
      const isSentimentRelated = this.isSentimentRelatedByKeywords(message);

      // Fast path 0: smalltalk -> skip Groq
      if (isSmalltalk) {
        const sessionMetadata = await conversationStore.getSessionMetadata(conversationId);
        const cachedLevel = sessionMetadata?.user_level ?? 'intermediate';
        return this.buildFastPathResult(
          'smalltalk',
          cachedLevel,
          conversationId,
          false,
          false,
          false,
          false
        );
      }

      // Fast path 1: chartId in metadata -> treat as chart_analysis, skip Groq
      if (metadata?.chartId) {
        const sessionMetadata = await conversationStore.getSessionMetadata(conversationId);
        const cachedLevel = sessionMetadata?.user_level ?? 'intermediate';
        return this.buildFastPathResult(
          'chart_analysis',
          cachedLevel,
          conversationId,
          false,
          true,
          false,
          false
        );
      }

      // Fast path 2: exactly one intent category from keywords, short message, and we have cached level
      const singleIntentCount = [isRiskRelated, isChartRelated, isJournalRelated, isSentimentRelated].filter(
        Boolean
      ).length;
      const shortMessage = message.trim().length < IntentDetector.MAX_MESSAGE_LENGTH_FAST_PATH;
      const sessionMetadata = await conversationStore.getSessionMetadata(conversationId);
      const cachedLevel = sessionMetadata?.user_level;

      if (singleIntentCount === 1 && shortMessage && cachedLevel) {
        if (isRiskRelated) {
          return this.buildFastPathResult(
            'risk_evaluation',
            cachedLevel,
            conversationId,
            true,
            false,
            false,
            false
          );
        }
        if (isChartRelated) {
          return this.buildFastPathResult(
            'chart_analysis',
            cachedLevel,
            conversationId,
            false,
            true,
            false,
            false
          );
        }
        if (isJournalRelated) {
          return this.buildFastPathResult(
            'journal_coaching',
            cachedLevel,
            conversationId,
            false,
            false,
            true,
            false
          );
        }
        if (isSentimentRelated) {
          return this.buildFastPathResult(
            'sentiment_snapshot',
            cachedLevel,
            conversationId,
            false,
            false,
            false,
            true
          );
        }
      }

      // If we have recent history and cached level, use LLM for intent but keep cached level
      if (cachedLevel && conversationHistory.length > 0) {
        // Use cached level, but still detect intent
        const intentResult = await this.classifyIntentWithLLM(message, conversationHistory, modelId);

        logger.info('Intent result', { intentResult });

        // Check if ANY intent is risk-related, chart-related, journal-related, or sentiment-related
        const hasRiskIntent = intentResult.intents.some((item) => this.isRiskIntent(item.intent));
        const hasChartIntent = intentResult.intents.some(
          (item) => item.intent === 'chart_analysis'
        );
        const hasJournalIntent = intentResult.intents.some((item) =>
          this.isJournalIntent(item.intent)
        );
        const hasSentimentIntent = intentResult.intents.some(
          (item) => item.intent === 'sentiment_snapshot'
        );

        // Update metadata with latest primary intent
        await conversationStore.updateSessionMetadata(conversationId, {
          last_intent: intentResult.primaryIntent,
          user_level: cachedLevel, // Keep cached level
        });

        return {
          intents: intentResult.intents,
          primaryIntent: intentResult.primaryIntent,
          user_level: cachedLevel,
          isRiskRelated: isRiskRelated || hasRiskIntent,
          isChartRelated: isChartRelated || hasChartIntent,
          isJournalRelated: isJournalRelated || hasJournalIntent,
          isSentimentRelated: isSentimentRelated || hasSentimentIntent,
          coachingIntent: hasJournalIntent
            ? this.mapJournalIntentToCoachingIntent(intentResult.primaryIntent)
            : undefined,
        };
      }

      // Full classification call
      const result = await this.classifyIntentWithLLM(message, conversationHistory, modelId);

      // Check if ANY intent is risk-related, chart-related, journal-related, or sentiment-related
      const hasRiskIntent = result.intents.some((item) => this.isRiskIntent(item.intent));
      const hasChartIntent = result.intents.some((item) => item.intent === 'chart_analysis');
      const hasJournalIntent = result.intents.some((item) => this.isJournalIntent(item.intent));
      const hasSentimentIntent = result.intents.some(
        (item) => item.intent === 'sentiment_snapshot'
      );

      // Cache the results in session metadata
      await conversationStore.updateSessionMetadata(conversationId, {
        user_level: result.user_level,
        last_intent: result.primaryIntent,
      });

      logger.info('Intent detected', {
        conversationId,
        intents: result.intents.map((i) => `${i.intent}(${i.confidence.toFixed(2)})`).join(', '),
        primaryIntent: result.primaryIntent,
        user_level: result.user_level,
        isRiskRelated: isRiskRelated || hasRiskIntent,
        isChartRelated: isChartRelated || hasChartIntent,
        isJournalRelated: isJournalRelated || hasJournalIntent,
        isSentimentRelated: isSentimentRelated || hasSentimentIntent,
      });

      return {
        intents: result.intents,
        primaryIntent: result.primaryIntent,
        user_level: result.user_level,
        isRiskRelated: isRiskRelated || hasRiskIntent,
        isChartRelated: isChartRelated || hasChartIntent,
        isJournalRelated: isJournalRelated || hasJournalIntent,
        isSentimentRelated: isSentimentRelated || hasSentimentIntent,
        coachingIntent: hasJournalIntent
          ? this.mapJournalIntentToCoachingIntent(result.primaryIntent)
          : undefined,
      };
    } catch (error) {
      logger.error('Intent detection failed', {
        error: (error as Error).message,
        conversationId,
      });

      // Fallback to safe defaults
      const fallback: IntentDetectionResult = {
        intents: [{ intent: 'education', confidence: 1.0 }],
        primaryIntent: 'education',
        user_level: 'intermediate',
        isRiskRelated: false,
        isChartRelated: false,
        isJournalRelated: false,
        isSentimentRelated: false,
      };

      // Try to use cached level if available
      const sessionMetadata = await conversationStore.getSessionMetadata(conversationId);
      if (sessionMetadata?.user_level) {
        fallback.user_level = sessionMetadata.user_level;
      }

      // Check keywords even in fallback
      fallback.isRiskRelated = this.isRiskRelatedByKeywords(message);
      fallback.isChartRelated = this.isChartRelatedByKeywords(message) || !!metadata?.chartId;
      fallback.isJournalRelated = this.isJournalRelatedByKeywords(message);
      fallback.isSentimentRelated = this.isSentimentRelatedByKeywords(message);
      if (fallback.isJournalRelated) {
        fallback.coachingIntent = 'overview';
      }

      return fallback;
    }
  }

  /**
   * Check if an intent is risk-related.
   */
  private isRiskIntent(intent: string): boolean {
    return (
      intent === 'risk_evaluation' ||
      intent === 'position_sizing' ||
      intent === 'risk_policy_explanation'
    );
  }

  /**
   * Check if an intent is journal-related.
   */
  private isJournalIntent(intent: string): boolean {
    return (
      intent === 'journal_coaching' ||
      intent === 'journal_overview' ||
      intent === 'journal_recent' ||
      intent === 'journal_pattern_detection'
    );
  }

  /**
   * Get cached user level from session metadata without making API calls.
   */
  async getCachedUserLevel(
    conversationId: string
  ): Promise<'novice' | 'intermediate' | 'advanced' | null> {
    const metadata = await conversationStore.getSessionMetadata(conversationId);
    return metadata?.user_level || null;
  }
}

// Export singleton instance
export const intentDetector = new IntentDetector();
