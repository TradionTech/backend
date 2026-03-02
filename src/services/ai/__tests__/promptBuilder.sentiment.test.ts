/**
 * Tests for sentiment prompt building: driver labels and context block formatting.
 * Ensures user-facing labels and qualitative importance are used; no internal ids or raw weights.
 */

import { promptBuilder } from '../promptBuilder';
import type { SentimentContextForLLM } from '../../sentiment/sentimentTypes';

describe('PromptBuilder - Sentiment context block', () => {
  it('should include user-facing driver labels and qualitative importance, not weight or internal ids', () => {
    const sentimentContext: SentimentContextForLLM = {
      symbol: 'BTC',
      baseAssetClass: 'CRYPTO',
      windowDescription: 'last 4 hours',
      aggregate: {
        symbol: 'BTC',
        score: -0.35,
        direction: 'bearish',
        confidence: 0.7,
        signalsUsed: 4,
        sourcesUsed: ['price_action', 'crypto_fear_greed'],
      },
      drivers: [
        {
          id: 'fear_greed_index',
          label: 'Crypto Fear & Greed index',
          explanation: 'The Fear & Greed index shows strong fear (negative sentiment).',
          weight: 4.5,
        },
        {
          id: 'price_momentum',
          label: 'recent price action',
          explanation: 'Short- and medium-term price movement has been positive.',
          weight: 1.2,
        },
      ],
      rawStats: {
        bySource: [
          { source: 'crypto_fear_greed', avgScore: -0.76, signals: 3 },
          { source: 'price_action', avgScore: 0.12, signals: 1 },
        ],
        latestTimestamp: new Date(),
      },
      dataQuality: {
        hasEnoughSignals: false,
        signalsAvailable: 4,
        sourcesAvailable: ['price_action', 'crypto_fear_greed'],
        windowMinutes: 240,
        isFresh: false,
        issues: ['LOW_SIGNAL_COUNT', 'STALE_DATA'],
      },
    };

    const prompt = promptBuilder.buildSystemPrompt({
      userLevel: 'intermediate',
      intents: ['sentiment_snapshot'],
      primaryIntent: 'sentiment_snapshot',
      sentimentContext,
    });

    // Must contain user-facing labels
    expect(prompt).toContain('Crypto Fear & Greed index');
    expect(prompt).toContain('recent price action');

    // Must contain qualitative importance (high weight -> primary driver, medium -> important factor)
    expect(prompt).toContain('primary driver');
    expect(prompt).toContain('important factor');

    // Must NOT contain raw weight display or internal ids in the context block (drivers section)
    const contextMatch = prompt.match(/=== BACKEND_SENTIMENT_CONTEXT ===\s*([\s\S]*?)\s*=== END BACKEND_SENTIMENT_CONTEXT ===/);
    const contextBlock = contextMatch ? contextMatch[1] : '';
    expect(contextBlock).not.toMatch(/weight:\s*\d/);
    expect(contextBlock).not.toContain('fear_greed_index');
    expect(contextBlock).not.toContain('price_momentum');
  });

  it('should map By Source to user-facing names in context block', () => {
    const sentimentContext: SentimentContextForLLM = {
      symbol: 'EURUSD',
      windowDescription: 'last 4 hours',
      aggregate: null,
      drivers: [],
      rawStats: {
        bySource: [
          { source: 'price_action', avgScore: 0.1, signals: 3 },
          { source: 'alpha_vantage_news', avgScore: -0.2, signals: 2 },
        ],
      },
      dataQuality: {
        hasEnoughSignals: false,
        signalsAvailable: 5,
        sourcesAvailable: ['price_action', 'alpha_vantage_news'],
        windowMinutes: 240,
        isFresh: true,
        issues: [],
      },
    };

    const prompt = promptBuilder.buildSystemPrompt({
      userLevel: 'novice',
      intents: ['sentiment_snapshot'],
      primaryIntent: 'sentiment_snapshot',
      sentimentContext,
    });

    expect(prompt).toContain('Price action');
    expect(prompt).toContain('News sentiment');
  });
});
