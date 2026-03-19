import { logger } from '../../config/logger';

export interface SafetyCheckResult {
  isSafe: boolean;
  reason?: string;
  fallbackMessage?: string;
  hasDisclaimer?: boolean; // Whether response contains appropriate disclaimer
}

/** Extract the matched substring and the sentence (or surrounding span) containing it for logging. */
function getMatchContext(content: string, pattern: RegExp): { matchedPhrase: string; containingSentence: string } {
  const match = pattern.exec(content);
  const matchedPhrase = match ? match[0].trim() : '';
  if (!matchedPhrase) {
    return { matchedPhrase: '', containingSentence: content.substring(0, 300) };
  }
  const start = match!.index;
  const end = start + match![0].length;
  // Sentence boundaries: . ! ? or start/end of string
  const before = content.substring(0, start);
  const after = content.substring(end);
  const sentenceStart = Math.max(0, Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n')) + 1);
  const sentenceEnd =
    after.indexOf('. ') >= 0 ? end + after.indexOf('. ') + 2
    : after.indexOf('! ') >= 0 ? end + after.indexOf('! ') + 2
    : after.indexOf('? ') >= 0 ? end + after.indexOf('? ') + 2
    : after.indexOf('\n') >= 0 ? end + after.indexOf('\n')
    : content.length;
  const containingSentence = content.substring(sentenceStart, sentenceEnd).trim();
  return { matchedPhrase, containingSentence: containingSentence || content.substring(Math.max(0, start - 80), end + 80) };
}

/**
 * Post-processing safety guardrails to detect and prevent unsafe responses.
 * Scans for disallowed patterns and provides safe fallback messages.
 * When a pattern matches, a two-step check (rule-based) can reclassify as educational.
 */
export class SafetyGuard {
  private isNonFinancialContext(containingSentence: string): boolean {
    const lower = containingSentence.toLowerCase();
    const nonFinancialCues = [
      'json',
      'json-only',
      'formatting',
      'schema',
      'system prompt',
      'system',
      'api',
      'deterministic',
      'rule',
      'parser',
      'response format',
      'structured data',
      'backend',
    ];
    return nonFinancialCues.some((cue) => lower.includes(cue));
  }

  /**
   * Rule-based two-step: if the matched sentence looks educational (e.g. "you should sell when your stop is hit"),
   * treat as safe and do not replace.
   */
  private isLikelyEducational(containingSentence: string): boolean {
    const lower = containingSentence.toLowerCase();
    const educationalCues = [
      'when your stop',
      'when the stop is hit',
      'when the stop gets hit',
      'when price hits your stop',
      'in a backtest',
      'for example',
      'as an example',
      'in general',
      'typically',
      'generally',
      'in that case',
      'in theory',
      'as a rule',
      'under those circumstances',
      'formatting rule',
      'response format',
    ];
    return educationalCues.some((cue) => lower.includes(cue));
  }

  /**
   * Check if a response contains unsafe patterns.
   * Returns result with isSafe flag and optional fallback message.
   * When a pattern matches, runs two-step check (educational vs execution) before applying fallback.
   */
  checkResponse(content: string): SafetyCheckResult {
    // Pattern 1: Explicit execution instructions
    const executionPatterns = [
      /\b(?:buy|sell|enter|exit|open|close)\s+(?:a|an|the)?\s*(?:position|trade|order)\s+(?:at|now|immediately)/i,
      /\b(?:you should|you must|you need to)\s+(?:buy|sell|enter|exit|open|close)\s+[^.]*(?:now|immediately|at\s+\$?[\d,])/i,
      /\b(?:place|execute|submit)\s+(?:a|an|the)?\s*(?:order|trade)/i,
      /\b(?:go|take)\s+(?:all-in|all in\b|long|short)\s+(?:on|at)/i,
    ];

    for (const pattern of executionPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: execution instruction detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains explicit execution instructions',
          fallbackMessage: this.getFallbackMessage('execution'),
        };
      }
    }

    // Pattern 2: Personalized advice with specific prices/amounts (imperative + price in same sentence)
    const personalizedPatterns = [
      /\b(?:you should|you must|you need to|I recommend you)\s+.*\s+(?:at|for)\s+\$?[\d,]+(?:\s+(?:now|immediately))?/i,
      /\b(?:buy|sell)\s+.*\s+(?:at|for)\s+\$?[\d,]+(?:\s+(?:now|immediately))?/i,
      /\b(?:enter|exit)\s+.*\s+(?:at|for)\s+\$?[\d,]+(?:\s+(?:now|immediately))?/i,
    ];

    for (const pattern of personalizedPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: personalized advice detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains personalized financial advice with specific prices',
          fallbackMessage: this.getFallbackMessage('personalized'),
        };
      }
    }

    // Pattern 3: Definitive predictions with certainty
    const predictionPatterns = [
      /\b(?:will|will definitely|will certainly|is guaranteed to)\s+(?:reach|hit|go to|be at)\s+\$?[\d,]+/i,
      /\b(?:will|will definitely|will certainly)\s+(?:happen|occur|take place)\s+(?:by|on|before)\s+/i,
      /\b(?:guaranteed|certain|definite|sure thing|100%)\s+(?:to|that|it will)/i,
    ];

    for (const pattern of predictionPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: definitive prediction detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains definitive price predictions',
          fallbackMessage: this.getFallbackMessage('prediction'),
        };
      }
    }

    // Pattern 4: Reckless behavior encouragement
    const recklessPatterns = [
      /\b(?:go all-in|all in\b|yolo|bet everything|risk it all)/i,
      /\b(?:don't worry|it's safe|no risk|guaranteed profit)/i,
    ];

    for (const pattern of recklessPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        // Avoid false positives where "no risk" refers to non-financial/system constraints.
        if (matchedPhrase.toLowerCase() === 'no risk' && this.isNonFinancialContext(containingSentence)) {
          continue;
        }
        logger.warn('Safety guard triggered: reckless behavior encouragement detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Encourages reckless trading behavior',
          fallbackMessage: this.getFallbackMessage('reckless'),
        };
      }
    }

    // Pattern 5: Risk-specific imperative trade commands
    const riskSpecificPatterns = [
      /\b(?:open|enter|buy|sell)\s+\d+(?:\.\d+)?\s*(?:lots?|units?|shares?)\s+(?:now|immediately|right now)/i,
      /\b(?:set|use|apply)\s+(?:leverage|margin)\s+(?:to|of)\s+\d+(?:x|×)\s+(?:and|then)\s+(?:enter|open|buy|sell)/i,
      /\b(?:buy|sell|enter|open)\s+[A-Z]+\s+(?:at|for)\s+\$?[\d,]+(?:\s+(?:now|immediately))?/i,
    ];

    for (const pattern of riskSpecificPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: risk-specific imperative command detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains imperative trade command in risk context',
          fallbackMessage: this.getFallbackMessage('risk_imperative'),
        };
      }
    }

    // Pattern 6: Journal coaching-specific violations
    // Detect trade execution commands in journal coaching context
    const journalExecutionPatterns = [
      /\b(?:you should|you must|you need to)\s+(?:buy|sell|enter|exit|open|close)\s+(?:a|an|the)?\s*(?:position|trade|order)/i,
      /\b(?:go|take)\s+(?:all-in|all in\b|long|short)\s+(?:on|at|now)/i,
      /\b(?:double down|double your position)\s+(?:to|and)\s+(?:recover|make up for)\s+(?:losses|loss)/i,
    ];

    for (const pattern of journalExecutionPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: journal coaching execution command detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains trade execution command in journal coaching context',
          fallbackMessage: this.getFallbackMessage('journal_execution'),
        };
      }
    }

    // Pattern 7: Psychological or medical advice (keep at trading behavior level)
    const medicalAdvicePatterns = [
      /\b(?:you're suffering from|you need therapy|you need counseling|you should see a|diagnosis|diagnose|mental health|depression|anxiety disorder)/i,
      /\b(?:you are|you're)\s+(?:clinically|medically|psychologically)\s+(?:depressed|anxious|disordered)/i,
    ];

    for (const pattern of medicalAdvicePatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: medical/psychological advice detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains medical or psychological advice',
          fallbackMessage: this.getFallbackMessage('medical_advice'),
        };
      }
    }

    // Pattern 8: Sentiment-specific trade calls
    // Detect direct trade calls based on sentiment ("Buy now because sentiment is bullish")
    const sentimentTradePatterns = [
      /\b(?:buy|sell|enter|open)\s+.*\s+(?:because|since|due to|given that)\s+(?:sentiment|everyone is|market mood|the sentiment)/i,
      /\b(?:sentiment|market mood|everyone is)\s+(?:is|are|suggests|indicates|means)\s+(?:bullish|bearish).*\s+(?:so|therefore|thus)\s+(?:buy|sell|enter|open)/i,
      /\b(?:with|given)\s+(?:such|this)\s+(?:bullish|bearish|positive|negative)\s+(?:sentiment|mood).*\s+(?:you should|you must|you need to)\s+(?:buy|sell|enter)/i,
    ];

    for (const pattern of sentimentTradePatterns) {
      const match = pattern.exec(content);
      if (match) {
        const { matchedPhrase, containingSentence } = getMatchContext(content, pattern);
        if (this.isLikelyEducational(containingSentence)) continue;
        logger.warn('Safety guard triggered: sentiment-based trade call detected', {
          pattern: pattern.toString(),
          matchedPhrase,
          containingSentence,
        });
        return {
          isSafe: false,
          reason: 'Contains trade call based on sentiment',
          fallbackMessage: this.getFallbackMessage('sentiment_trade'),
        };
      }
    }

    // Pattern 9: Check for disclaimer in risk-related, journal-related, or sentiment-related responses
    // Note: This is a soft check - we'll add disclaimer if missing but won't fail
    const hasDisclaimer =
      /(?:education|educational|risk awareness|user remains responsible|for educational purposes|coaching|performance improvement|sentiment is context)/i.test(
        content
      );

    return { isSafe: true, hasDisclaimer };
  }

  /**
   * Get a safe fallback message based on the type of violation detected.
   */
  private getFallbackMessage(violationType: string): string {
    const fallbacks: Record<string, string> = {
      execution: `I can't provide specific execution instructions or tell you exactly when to enter or exit trades. Instead, let me help you understand the principles and factors to consider:

**Facts:**
- Trading decisions should be based on your own analysis, risk tolerance, and trading plan
- Market conditions can change rapidly, making specific timing advice unreliable
- Every trader's situation is unique

**Interpretation:**
- Consider multiple factors: technical analysis, fundamental analysis, risk management, and your personal circumstances
- Develop a trading plan with clear entry/exit criteria before making decisions
- Use proper position sizing and risk management techniques

**Risk & Uncertainty:**
- Markets are unpredictable, and no strategy guarantees success
- Past performance doesn't predict future results
- Always use stop-losses and never risk more than you can afford to lose
- Consider consulting with a licensed financial advisor for personalized guidance`,

      personalized: `I can't provide personalized financial advice or recommend specific trades at particular prices. Instead, let me help you understand the general principles:

**Facts:**
- Trading decisions should be based on your own research and risk assessment
- Market prices are dynamic and can change rapidly
- What works for one trader may not work for another

**Interpretation:**
- Consider your own risk tolerance, financial situation, and trading goals
- Evaluate multiple factors: technical indicators, fundamentals, market sentiment
- Develop your own entry/exit criteria based on your analysis

**Risk & Uncertainty:**
- No one can predict exact price movements with certainty
- Every trade carries risk of loss
- Past performance doesn't guarantee future results
- Consider seeking advice from a licensed financial professional for personalized guidance`,

      prediction: `I can't make definitive predictions about future market prices or movements. Markets are inherently uncertain. Instead, let me provide analysis:

**Facts:**
- Market movements are influenced by many unpredictable factors
- Historical patterns don't guarantee future outcomes
- No one can predict exact price levels or timing with certainty

**Interpretation:**
- We can analyze probabilities and scenarios, but not certainties
- Multiple outcomes are always possible
- Consider various scenarios: bullish, bearish, and sideways

**Risk & Uncertainty:**
- Any price prediction carries significant uncertainty
- Markets can move in unexpected directions
- Always prepare for multiple possible outcomes
- Use risk management to protect against adverse movements`,

      reckless: `I can't encourage risky trading behavior like going all-in or taking excessive risks. Responsible trading requires proper risk management:

**Facts:**
- Trading always involves risk of loss
- No strategy or trade is guaranteed to be profitable
- Proper risk management is essential for long-term success

**Interpretation:**
- Successful trading requires discipline, patience, and risk management
- Never risk more than you can afford to lose
- Diversification and position sizing are crucial
- Emotional decisions often lead to losses

**Risk & Uncertainty:**
- High-risk strategies can lead to significant losses
- Markets can move against you at any time
- Many traders lose money, especially when taking excessive risks
- Consider starting with small positions and learning gradually`,

      risk_imperative: `I can't provide direct trade execution instructions. This assistant is for education and risk awareness. You remain responsible for all execution choices.

**Facts:**
- Risk analysis and education are provided for informational purposes only
- All trading decisions and executions are your responsibility
- Market conditions can change rapidly

**Interpretation:**
- Use the risk metrics and policy flags provided to inform your decisions
- Consider your own risk tolerance and trading plan
- Consult with licensed financial professionals for personalized advice

**Risk & Uncertainty:**
- Markets are unpredictable, and no analysis guarantees outcomes
- Past performance doesn't predict future results
- Always use proper risk management techniques`,

      journal_execution: `I can't provide specific trade execution instructions. As a trading performance coach, I focus on analyzing your past trades and providing educational feedback, not telling you what to trade.

**Facts:**
- This assistant analyzes historical trading performance for educational purposes
- All trading decisions and executions are your responsibility
- Past performance analysis doesn't guarantee future results

**Interpretation:**
- Use the performance analysis and patterns identified to inform your future decisions
- Focus on improving your process, risk management, and discipline
- Develop your own trading plan based on your analysis

**Risk & Uncertainty:**
- Markets are unpredictable, and no strategy guarantees success
- Past patterns may not continue in the future
- Always use proper risk management techniques`,

      medical_advice: `I can't provide medical or psychological advice. I focus on trading behavior and performance analysis at an educational level.

**Facts:**
- This assistant is for trading education and performance coaching
- I discuss trading behavior, not medical or psychological conditions
- Trading challenges are addressed from a behavioral and process perspective

**Interpretation:**
- Focus on trading discipline, risk management, and process improvement
- Address emotional trading patterns as behavioral habits, not medical conditions
- Consider consulting with licensed professionals for medical or psychological concerns

**Risk & Uncertainty:**
- Trading involves emotional challenges that are normal
- If you're experiencing significant emotional distress, consider speaking with a licensed professional
- This assistant focuses on trading education, not medical or therapeutic advice`,

      sentiment_trade: `I can't provide direct trade recommendations based on sentiment alone. Sentiment is one factor among many, and it should be used as context, not as a standalone trading signal.

**Facts:**
- Market sentiment reflects current mood and opinions, not guaranteed price movements
- Sentiment can diverge from price action and fundamentals
- Sentiment data has limitations: it may be sparse, stale, or from limited sources
- No single indicator, including sentiment, should be the sole basis for trading decisions

**Interpretation:**
- Use sentiment as one piece of information in your broader analysis
- Consider sentiment alongside technical analysis, fundamentals, risk management, and your trading plan
- Sentiment can change quickly, and past sentiment doesn't predict future prices
- Different sentiment sources may conflict, requiring careful interpretation

**Risk & Uncertainty:**
- Sentiment is not a trading signal by itself
- Markets can move against sentiment (contrarian moves)
- Sentiment data quality varies and may be incomplete
- Always use proper risk management regardless of sentiment readings
- Consider consulting with licensed financial professionals for personalized guidance`,
    };

    return fallbacks[violationType] || fallbacks.execution;
  }

  /**
   * Ensure risk-related responses contain appropriate disclaimer.
   * Adds disclaimer if missing (does not fail the response).
   */
  ensureRiskDisclaimer(content: string, isRiskRelated: boolean): string {
    if (!isRiskRelated) {
      return content;
    }

    const hasDisclaimer =
      /(?:education|educational|risk awareness|user remains responsible|for educational purposes|disclaimer)/i.test(
        content
      );

    if (!hasDisclaimer) {
      const disclaimer = `\n\n---\n*This assistant is for education and risk awareness purposes only. You remain responsible for all trading decisions and execution choices.*`;
      return content + disclaimer;
    }

    return content;
  }
}

// Export singleton instance
export const safetyGuard = new SafetyGuard();
