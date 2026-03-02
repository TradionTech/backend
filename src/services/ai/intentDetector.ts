import { groqCompoundClient, type GroqMessage } from './groqCompoundClient';
import { conversationStore } from './conversationStore';
import { logger } from '../../config/logger';

export type Intent =
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
    metadata?: { chartId?: string; [key: string]: unknown }
  ): Promise<IntentDetectionResult> {
    try {
      // Fast pre-check: rule-based keyword detection
      const isRiskRelated = this.isRiskRelatedByKeywords(message);
      const isChartRelated = this.isChartRelatedByKeywords(message) || !!metadata?.chartId;
      const isJournalRelated = this.isJournalRelatedByKeywords(message);
      const isSentimentRelated = this.isSentimentRelatedByKeywords(message);

      // Check if we have cached user_level in session metadata
      const sessionMetadata = await conversationStore.getSessionMetadata(conversationId);
      const cachedLevel = sessionMetadata?.user_level;

      // If we have recent history and cached level, we can use a simpler classification
      // Otherwise, do a full Groq call
      if (cachedLevel && conversationHistory.length > 0) {
        // Use cached level, but still detect intent
        const intentResult = await groqCompoundClient.detectIntent(message, conversationHistory);

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
      const result = await groqCompoundClient.detectIntent(message, conversationHistory);

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
