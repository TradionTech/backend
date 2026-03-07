import type { GroqMessage } from './groqCompoundClient';
import type { MarketContext } from '../../types/market';
import type { JournalContextForLLM, CoachingIntent } from '../journal/journalTypes';

export type UserLevel = 'novice' | 'intermediate' | 'advanced';
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

export interface PromptContext {
  userLevel: UserLevel;
  intents: Intent[]; // Array of all detected intents
  primaryIntent: Intent; // For backward compatibility
  marketContext?: MarketContext;
  riskContext?: import('../risk/riskOrchestrator').RiskContextForLLM | null;
  chartContext?: import('../chart/chartTypes').ChartContextForLLM | null;
  sentimentContext?: import('../sentiment/sentimentTypes').SentimentContextForLLM | null;
}

/**
 * Service for building system prompts with safety rules, tone adaptation, and structured response requirements.
 */
export class PromptBuilder {
  /**
   * Build the system prompt based on user level, intent, and market context.
   * Enforces safety rules and response structure requirements.
   */
  buildSystemPrompt(context: PromptContext): string {
    const {
      userLevel,
      intents,
      primaryIntent,
      marketContext,
      riskContext,
      chartContext,
      sentimentContext,
    } = context;

    // Check if ANY intent is risk-related
    const hasRiskIntent = intents.some((intent) => this.isRiskIntent(intent));

    // Check if chart analysis intent
    const hasChartIntent = intents.some((intent) => intent === 'chart_analysis');

    // Check if sentiment snapshot intent
    const hasSentimentIntent = intents.some((intent) => intent === 'sentiment_snapshot');

    // If risk-related intent, use risk-specific prompt
    if (riskContext && hasRiskIntent) {
      return this.buildRiskPrompt({
        userLevel,
        intent: primaryIntent,
        marketContext,
        riskContext,
      });
    }

    // If chart analysis intent, use chart-specific prompt
    if (chartContext && hasChartIntent) {
      return this.buildChartAnalysisPrompt({
        userLevel,
        intents,
        primaryIntent,
        marketContext,
        chartContext,
      });
    }

    // If sentiment snapshot intent, use sentiment-specific prompt
    if (sentimentContext && hasSentimentIntent) {
      return this.buildSentimentPrompt({
        userLevel,
        intents,
        primaryIntent,
        marketContext,
        sentimentContext,
      });
    }

    // Standard prompt for non-risk intents
    const safetyRules = this.getSafetyRules();
    const responseStructure = this.getResponseStructure();
    const toneGuidance = this.getToneGuidance(userLevel, intents, primaryIntent);
    const marketContextSection = this.buildMarketContextSection(marketContext);
    const intentGuidance = this.getMultiIntentGuidance(intents, primaryIntent);

    return `You are TradionAI, an expert trading education and analysis assistant. Your role is to help traders learn, analyze, and make informed decisions while maintaining strict safety boundaries.

${safetyRules}

${responseStructure}

${toneGuidance}

${intentGuidance}

${marketContextSection}

Remember: Your goal is education and analysis, not providing personalized financial advice or definitive predictions. Always prioritize user safety and learning.`;
  }

  /**
   * Check if intent is risk-related.
   */
  private isRiskIntent(intent: Intent): boolean {
    return (
      intent === 'risk_evaluation' ||
      intent === 'position_sizing' ||
      intent === 'risk_policy_explanation'
    );
  }

  /**
   * Core safety rules that must be enforced in all responses.
   */
  private getSafetyRules(): string {
    return `CRITICAL SAFETY RULES (MUST FOLLOW):

1. NO PERSONALIZED FINANCIAL ADVICE:
   - Never say "you should buy/sell X at price Y"
   - Never provide specific entry/exit instructions for the user
   - Never recommend specific position sizes or leverage amounts
   - Frame advice in general principles and educational terms

2. NO DEFINITIVE PRICE PREDICTIONS:
   - Never state "X will reach $Y by date Z"
   - Never claim certainty about future market movements
   - Use probabilistic language: "may", "could", "might", "scenarios suggest"
   - Acknowledge that markets are unpredictable

3. NO FABRICATED DATA OR EVENTS:
   - Only reference real, verifiable information
   - If you don't know something, explicitly state uncertainty
   - Never invent market data, news, or events
   - When market context is missing, say so clearly

4. EXPLICIT UNCERTAINTY:
   - When confidence is low, state it explicitly
   - When information is incomplete, acknowledge it
   - When context is missing, ask clarifying questions instead of guessing
   - Use phrases like "Based on limited information..." or "Without more context..."`;
  }

  /**
   * Response structure requirements: three clear sections.
   */
  private getResponseStructure(): string {
    return `RESPONSE STRUCTURE (REQUIRED):

You MUST structure every response into three clear sections:

1. **Facts**:
   - Verifiable information, current market context (if available), definitions
   - What is known and can be confirmed
   - Data points, historical context, established concepts
   - Keep this section factual and objective

2. **Interpretation**:
   - What these facts might mean
   - Possible scenarios and tradeoffs
   - How different factors could interact
   - Analysis of potential implications
   - This is where you provide your analytical perspective

3. **Risk & Uncertainty**:
   - Probabilities and scenarios (not certainties)
   - Missing data or incomplete information
   - Caveats and limitations
   - What could go wrong or what's unknown
   - Explicit hedging of any claims

Format your response clearly with these three section headers. Be concise but thorough.`;
  }

  /**
   * Tone and style guidance based on user level and intents.
   */
  private getToneGuidance(userLevel: UserLevel, intents: Intent[], primaryIntent: Intent): string {
    let guidance = '';

    // User level adaptations
    if (userLevel === 'novice') {
      guidance += `USER LEVEL: NOVICE
- Provide step-by-step explanations
- Define trading terms and concepts
- Use simple, clear language
- Break down complex ideas into digestible parts
- Offer context for why things matter
- Be patient and educational\n\n`;
    } else if (userLevel === 'advanced') {
      guidance += `USER LEVEL: ADVANCED
- Assume familiarity with trading concepts
- Focus on nuanced analysis and edge cases
- Discuss advanced strategies and risk management
- Reference sophisticated market dynamics
- Be concise but thorough\n\n`;
    } else {
      guidance += `USER LEVEL: INTERMEDIATE
- Balance explanation with depth
- Define complex terms but assume basic knowledge
- Provide practical examples
- Discuss both concepts and applications\n\n`;
    }

    // Intent-specific adaptations (for primary intent)
    if (primaryIntent === 'education') {
      guidance += `PRIMARY INTENT: EDUCATION
- Focus on teaching and explanation
- Provide comprehensive context
- Use examples and analogies where helpful
- Encourage learning and understanding\n\n`;
    } else if (primaryIntent === 'analysis') {
      guidance += `PRIMARY INTENT: ANALYSIS
- Focus on evaluating the specific situation or idea
- Provide critical analysis
- Highlight both strengths and weaknesses
- Discuss multiple perspectives and scenarios
- Emphasize risk assessment\n\n`;
    } else if (primaryIntent === 'clarification') {
      guidance += `PRIMARY INTENT: CLARIFICATION
- Address the specific point of confusion
- Be precise and direct
- Reference previous context if relevant
- Ensure the explanation resolves the question\n\n`;
    } else if (primaryIntent === 'validation') {
      guidance += `PRIMARY INTENT: VALIDATION
- Evaluate the user's trading idea or strategy
- Provide constructive feedback
- Highlight both what's good and what could be improved
- Focus on risk management and edge cases
- Be honest but supportive\n\n`;
    }

    return guidance;
  }

  /**
   * Guidance for handling multiple intents in a single message.
   */
  private getMultiIntentGuidance(intents: Intent[], primaryIntent: Intent): string {
    if (intents.length <= 1) {
      return '';
    }

    const intentNames = intents.map((intent) => {
      const names: Record<Intent, string> = {
        education: 'education',
        analysis: 'analysis',
        clarification: 'clarification',
        validation: 'validation',
        risk_evaluation: 'risk evaluation',
        position_sizing: 'position sizing',
        risk_policy_explanation: 'risk policy explanation',
        chart_analysis: 'chart analysis',
        journal_coaching: 'journal coaching',
        journal_overview: 'journal overview',
        journal_recent: 'journal recent',
        journal_pattern_detection: 'journal pattern detection',
        sentiment_snapshot: 'sentiment snapshot',
      };
      return names[intent];
    });

    return `MULTIPLE INTENTS DETECTED:

The user's message contains multiple intents: ${intentNames.join(', ')}.

You MUST address ALL detected intents in your response:
- Primary intent (${primaryIntent}): This should receive the most focus
- Secondary intents: Address these as well, ensuring you cover all aspects of the user's query

Structure your response to comprehensively address each intent while maintaining a coherent flow.`;
  }

  /**
   * Build market context section for system prompt.
   * Converts structured MarketContext to text instructions for the LLM.
   */
  private buildMarketContextSection(marketContext?: MarketContext): string {
    if (!marketContext) {
      return '\n\nNote: Market context is not available. Always state when information is missing or uncertain. Avoid making specific claims about current prices or recent events.';
    }

    const sections: string[] = [];
    sections.push('\n\n=== CURRENT MARKET CONTEXT ===');

    // Instrument info
    sections.push(
      `\nInstrument: ${marketContext.instrument.symbol} (${marketContext.instrument.assetClass})`
    );
    if (marketContext.instrument.base && marketContext.instrument.quote) {
      sections.push(`FX Pair: ${marketContext.instrument.base}/${marketContext.instrument.quote}`);
    }

    // Timeframe
    if (marketContext.timeframe) {
      sections.push(
        `Timeframe: ${marketContext.timeframe.label} (${marketContext.timeframe.size}${marketContext.timeframe.unit})`
      );
    }

    // Price snapshot
    if (marketContext.priceSnapshot) {
      const ps = marketContext.priceSnapshot;
      sections.push(`\nPrice Data:`);
      sections.push(`  Last: ${ps.last.toFixed(4)}`);
      if (ps.changePct !== undefined) {
        const changeSign = ps.changePct >= 0 ? '+' : '';
        sections.push(`  Change: ${changeSign}${ps.changePct.toFixed(2)}%`);
      }
      if (ps.high !== undefined && ps.low !== undefined) {
        sections.push(`  Range: ${ps.low.toFixed(4)} - ${ps.high.toFixed(4)}`);
      }
      sections.push(`  Timestamp: ${new Date(ps.timestamp).toISOString()}`);
    }

    // Trend signals
    if (marketContext.trendSignals) {
      sections.push(
        `\nTrend: ${marketContext.trendSignals.trend.toUpperCase()} (${marketContext.trendSignals.basis.replace('_', ' ')})`
      );
    }

    // Volatility signals
    if (marketContext.volatilitySignals) {
      sections.push(`Volatility: ${marketContext.volatilitySignals.volatilityLevel.toUpperCase()}`);
      if (marketContext.volatilitySignals.value !== undefined) {
        sections.push(
          `  Metric: ${marketContext.volatilitySignals.metric || 'N/A'} = ${marketContext.volatilitySignals.value.toFixed(2)}%`
        );
      }
    }

    // Data quality
    const dq = marketContext.dataQuality;
    sections.push(`\nData Quality:`);
    sections.push(`  Source: ${dq.source}`);
    sections.push(`  Fresh: ${dq.isFresh ? 'Yes' : 'No'}`);
    if (!dq.isFresh && dq.ageSeconds !== undefined) {
      const ageMinutes = Math.floor(dq.ageSeconds / 60);
      sections.push(`  Age: ${ageMinutes} minutes (${dq.ageSeconds.toFixed(0)} seconds)`);
    }
    if (dq.issues && dq.issues.length > 0) {
      sections.push(`  Issues: ${dq.issues.join(', ')}`);
    }

    // Instructions for LLM
    sections.push(`\n\nIMPORTANT INSTRUCTIONS FOR USING MARKET CONTEXT:`);
    sections.push(
      `- This MarketContext is the canonical source of truth for current market conditions.`
    );
    sections.push(`- Use this data when relevant to answer the user's question.`);

    if (!dq.isFresh) {
      sections.push(`- ⚠️ DATA IS STALE: The data quality shows isFresh=false.`);
      sections.push(`  You MUST explicitly acknowledge this in your response.`);
      sections.push(`  Avoid giving precise current prices or recent events.`);
      sections.push(`  Speak in terms of general principles and acknowledge data limitations.`);
    }

    if (dq.issues && dq.issues.length > 0) {
      sections.push(`- ⚠️ DATA QUALITY ISSUES: ${dq.issues.join(', ')}`);
      sections.push(`  Acknowledge these limitations in your response.`);
    }

    sections.push(`- If MarketContext is missing or incomplete, explicitly state this.`);
    sections.push(`- Never pretend to know current prices or events if data is unavailable.`);
    sections.push(
      `- Adapt your reasoning based on asset class (FX vs crypto vs equity have different characteristics).`
    );

    return sections.join('\n');
  }

  /**
   * Build risk-specific system prompt for risk-related conversations.
   * Includes numeric truth contract and structured risk context.
   */
  private buildRiskPrompt(args: {
    userLevel: UserLevel;
    intent: Intent;
    marketContext?: MarketContext;
    riskContext: import('../risk/riskOrchestrator').RiskContextForLLM;
  }): string {
    const { userLevel, intent, marketContext, riskContext } = args;

    const rolesAndBoundaries = this.getRiskRolesAndBoundaries();
    const numericTruthContract = this.getNumericTruthContract();
    const responseStructure = this.getRiskResponseStructure();
    const riskContextBlock = this.buildRiskContextBlock(riskContext);
    // Convert single intent to array format for getToneGuidance
    const toneGuidance = this.getToneGuidance(userLevel, [intent], intent);
    const marketContextSection = this.buildMarketContextSection(marketContext);

    return `You are TradionAI, a trading risk assistant. Your role is to explain risk and money management using the numerical results and policy flags provided.

${rolesAndBoundaries}

${numericTruthContract}

${responseStructure}

${riskContextBlock}

${toneGuidance}

${marketContextSection}

Remember: All numeric values are authoritative and come from the risk engine and backend. You must treat these numbers as read-only facts. Never invent or adjust numeric values.`;
  }

  /**
   * Roles and boundaries for risk assistant.
   */
  private getRiskRolesAndBoundaries(): string {
    return `ROLES & BOUNDARIES:

- You are a trading risk assistant
- You explain risk and money management using the numerical results provided
- You must NOT invent or adjust any numeric values
- You must NOT provide personalized financial advice or guaranteed predictions
- You may discuss scenarios, heuristics, and educational principles
- This assistant is for education and risk awareness
- User remains responsible for execution choices`;
  }

  /**
   * Numeric truth contract for risk conversations.
   */
  private getNumericTruthContract(): string {
    return `NUMERIC TRUTH CONTRACT (CRITICAL):

- All numeric fields (account equity, risk per trade, RR, leverage, etc.) are authoritative and come from the risk engine and backend
- You must treat these numbers as read-only facts
- When you reference numbers, copy them exactly
- If a number seems strange, you explain that it may be due to user inputs or configuration, but you DO NOT change it
- Never calculate or derive numbers yourself - use only the provided values`;
  }

  /**
   * Response structure for risk conversations (5 sections).
   */
  private getRiskResponseStructure(): string {
    return `RESPONSE STRUCTURE (REQUIRED):

You MUST structure every risk-related response into five clear sections:

1. **Summary**:
   - High-level assessment in 2-3 sentences
   - Overall risk level and key concerns

2. **Key Numbers**:
   - Bullet list of the main metrics (riskPerTradeUsd, riskPerTradePct, totalRiskPct, effectiveLeverage, RR, etc.)
   - Copy numbers exactly from the BACKEND_RISK_CONTEXT

3. **Policy Evaluation**:
   - Explanation of each policy flag (RISK_PER_TRADE_TOO_HIGH, RR_TOO_LOW, etc.)
   - What each flag means and why it was triggered
   - Severity levels (info, warning, high)

4. **Guidance & Alternatives**:
   - Educational suggestions aligned with riskProfile (e.g., smaller size, wider stop, different target)
   - Explicitly non-prescriptive
   - Discuss principles and scenarios, not commands

5. **Uncertainty & Limitations**:
   - What is not known (e.g., stale market data, incomplete history)
   - Disclaimers about risk and market unpredictability
   - Limitations of the analysis`;
  }

  /**
   * Build the BACKEND_RISK_CONTEXT block for LLM consumption.
   */
  private buildRiskContextBlock(
    riskContext: import('../risk/riskOrchestrator').RiskContextForLLM
  ): string {
    const {
      userContext,
      accountStateSummary,
      profileMetrics,
      marketSnapshot,
      riskEvaluation,
      missingFields,
    } = riskContext;

    // Clarification mode: missing fields
    if (missingFields.length > 0 && missingFields[0] !== 'error') {
      return `=== BACKEND_RISK_CONTEXT (CLARIFICATION MODE) ===

The user's trade description is incomplete. The following required fields are missing:
${missingFields.map((f) => `- ${f}`).join('\n')}

Do NOT show any risk metrics or evaluation results. Instead, ask concise, specific clarifying questions to fill the gaps.

Required fields for risk evaluation:
- symbol: Trading symbol (e.g., EURUSD, BTC, AAPL)
- side: "long" or "short"
- entryPrice: Entry price
- stopPrice: Stop loss price
- quantity: Position size/quantity
- timeframe: One of "scalp", "intraday", "swing", "position"

Optional fields:
- targetPrice: Take profit/target price
- leverage: Leverage amount
- orderType: "market" or "limit" (default: "market")

=== END BACKEND_RISK_CONTEXT ===`;
    }

    // Full evaluation mode
    if (riskEvaluation) {
      const { riskMetrics, policyFlags, engineVersion } = riskEvaluation;

      return `=== BACKEND_RISK_CONTEXT ===

UserContext:
- riskProfile: ${userContext.riskProfile}
- experienceLevel: ${userContext.experienceLevel}
- typicalRiskPerTradePct: ${userContext.typicalRiskPerTradePct}%
- typicalPositionSizeUsd: $${userContext.typicalPositionSizeUsd.toFixed(2)}

AccountStateSummary:
- equityUsd: $${accountStateSummary.equityUsd.toFixed(2)}
- availableMarginUsd: $${accountStateSummary.availableMarginUsd.toFixed(2)}
- openRiskUsd: $${accountStateSummary.openRiskUsd.toFixed(2)}
- openPositionsCount: ${accountStateSummary.openPositionsCount}

ProfileMetrics:${
        profileMetrics
          ? `
- avgRrRatio: ${profileMetrics.avgRrRatio?.toFixed(2) || 'N/A'}
- maxDrawdownPct: ${profileMetrics.maxDrawdownPct?.toFixed(2) || 'N/A'}%`
          : '\n- No profile metrics available (insufficient trade history)'
      }

MarketSnapshot:
- symbol: ${marketSnapshot.symbol}
- currentPrice: ${marketSnapshot.currentPrice.toFixed(4)}
- sessionVolatilityPct: ${marketSnapshot.sessionVolatilityPct?.toFixed(2) || 'N/A'}%

RiskMetrics:
- riskPerTradeUsd: $${riskMetrics.riskPerTradeUsd.toFixed(2)}
- riskPerTradePct: ${riskMetrics.riskPerTradePct.toFixed(2)}%
- rewardUsd: ${riskMetrics.rewardUsd ? `$${riskMetrics.rewardUsd.toFixed(2)}` : 'N/A'}
- rrRatio: ${riskMetrics.rrRatio?.toFixed(2) || 'N/A'}
- totalRiskUsd: $${riskMetrics.totalRiskUsd.toFixed(2)}
- totalRiskPct: ${riskMetrics.totalRiskPct.toFixed(2)}%
- effectiveLeverage: ${riskMetrics.effectiveLeverage.toFixed(2)}x
- riskVsTypicalFactor: ${riskMetrics.riskVsTypicalFactor.toFixed(2)}x
- sizeVsTypicalFactor: ${riskMetrics.sizeVsTypicalFactor.toFixed(2)}x

PolicyFlags:
${
  policyFlags.length > 0
    ? policyFlags.map((f) => `- [${f.severity.toUpperCase()}] ${f.code}: ${f.message}`).join('\n')
    : '- No policy violations detected'
}

EngineVersion: ${engineVersion}

=== END BACKEND_RISK_CONTEXT ===`;
    }

    // Error state
    return `=== BACKEND_RISK_CONTEXT (ERROR STATE) ===

An error occurred while building risk context. Please inform the user that risk evaluation is temporarily unavailable and suggest they try again or provide more complete trade information.

=== END BACKEND_RISK_CONTEXT ===`;
  }

  /**
   * Build the full message array for Groq API, including system prompt and conversation history.
   */
  buildMessages(
    systemPrompt: string,
    conversationHistory: GroqMessage[],
    currentUserMessage: string
  ): GroqMessage[] {
    const messages: GroqMessage[] = [{ role: 'system', content: systemPrompt }];

    // Add conversation history (excluding system messages)
    const historyMessages = conversationHistory.filter((msg) => msg.role !== 'system');
    messages.push(...historyMessages);

    // Add current user message
    messages.push({ role: 'user', content: currentUserMessage });

    return messages;
  }

  /**
   * Build chart analysis-specific system prompt.
   * Includes structured chart context and specialized instructions.
   */
  private buildChartAnalysisPrompt(args: {
    userLevel: UserLevel;
    intents: Intent[];
    primaryIntent: Intent;
    marketContext?: MarketContext;
    chartContext: import('../chart/chartTypes').ChartContextForLLM;
  }): string {
    const { userLevel, intents, primaryIntent, marketContext, chartContext } = args;

    const safetyRules = this.getSafetyRules();
    const toneGuidance = this.getToneGuidance(userLevel, intents, primaryIntent);
    const marketContextSection = this.buildMarketContextSection(marketContext);
    const chartContextBlock = this.buildChartContextBlock(chartContext);
    const intentGuidance = this.getMultiIntentGuidance(intents, primaryIntent);

    return `You are TradionAI, a trading chart analysis assistant. Your role is to analyze trading charts using the structured BACKEND_CHART_CONTEXT provided. You do NOT see the raw image - you only have access to the structured analysis results.

${safetyRules}

ROLE & BOUNDARIES:
- You are analyzing a trading chart based on structured vision analysis results
- The only "visual" information you have is the BACKEND_CHART_CONTEXT below
- You do NOT see the raw chart image
- Your analysis should be educational and scenario-based
- Avoid specific tradable advice (no "You should open X lots here")
- Keep it educational and acknowledge uncertainties

${chartContextBlock}

${toneGuidance}

${intentGuidance}

${marketContextSection}

RESPONSE STRUCTURE (REQUIRED):

You MUST structure your chart analysis response into five clear sections:

1. **Summary**:
   - High-level overview of what the chart shows (2-3 sentences)
   - Overall trend, key patterns, and notable features

2. **Detected Structure**:
   - Trend direction and strength
   - Chart patterns identified (with confidence levels)
   - Key support/resistance levels
   - Technical indicators observed
   - Notable events (breakouts, reversals, etc.)

3. **Alternative Interpretations**:
   - When patterns are borderline or low-confidence, discuss alternative views
   - Multiple possible scenarios based on the data
   - What could invalidate or confirm the detected patterns

4. **Market Context & Conditions**:
   - How the chart relates to current market conditions (if available)
   - Volatility context
   - Data quality and freshness considerations

5. **Uncertainty & Limitations**:
   - Explicitly mention any uncertainties from the vision analysis
   - Acknowledge missing or unclear information
   - Limitations of the analysis
   - What additional information would help

Remember: Always respect the uncertainty flags and pattern confidences provided in BACKEND_CHART_CONTEXT. If confidence is low, explicitly state that in your analysis.`;
  }

  /**
   * Build the BACKEND_CHART_CONTEXT block for LLM consumption.
   */
  private buildChartContextBlock(
    chartContext: import('../chart/chartTypes').ChartContextForLLM
  ): string {
    const {
      source,
      chartId,
      symbol,
      timeframeLabel,
      visionFeatures,
      marketContextSummary,
      uncertainty,
    } = chartContext;

    const sections: string[] = [];
    sections.push('=== BACKEND_CHART_CONTEXT ===');
    sections.push(`\nSource: ${source}`);
    if (chartId) {
      sections.push(`Chart ID: ${chartId}`);
    }
    if (symbol) {
      sections.push(`Symbol: ${symbol}`);
    }
    if (timeframeLabel) {
      sections.push(`Timeframe: ${timeframeLabel}`);
    }

    // Vision Features
    sections.push(`\nVision Features:`);
    sections.push(`  Primary Trend: ${visionFeatures.primaryTrend || 'unclear'}`);

    if (visionFeatures.metadata.symbol) {
      sections.push(`  Detected Symbol: ${visionFeatures.metadata.symbol}`);
    }
    if (visionFeatures.metadata.timeframeLabel) {
      sections.push(`  Detected Timeframe: ${visionFeatures.metadata.timeframeLabel}`);
    }

    if (visionFeatures.patterns.length > 0) {
      sections.push(`\n  Patterns (${visionFeatures.patterns.length}):`);
      visionFeatures.patterns.forEach((p) => {
        sections.push(
          `    - ${p.code} (confidence: ${(p.confidence * 100).toFixed(0)}%): ${p.description}`
        );
      });
    }

    if (visionFeatures.keyLevels.length > 0) {
      sections.push(`\n  Key Levels (${visionFeatures.keyLevels.length}):`);
      visionFeatures.keyLevels.forEach((l) => {
        sections.push(
          `    - ${l.type.toUpperCase()}: ${l.price.toFixed(4)} (confidence: ${(l.confidence * 100).toFixed(0)}%)${l.label ? ` - ${l.label}` : ''}`
        );
      });
    }

    if (visionFeatures.indicators.length > 0) {
      sections.push(`\n  Indicators (${visionFeatures.indicators.length}):`);
      visionFeatures.indicators.forEach((i) => {
        sections.push(`    - ${i.name}: ${i.observation}`);
      });
    }

    if (visionFeatures.notableEvents.length > 0) {
      sections.push(`\n  Notable Events:`);
      visionFeatures.notableEvents.forEach((e) => {
        sections.push(`    - ${e}`);
      });
    }

    if (visionFeatures.notes.length > 0) {
      sections.push(`\n  Notes:`);
      visionFeatures.notes.forEach((n) => {
        sections.push(`    - ${n}`);
      });
    }

    // Market Context Summary
    if (marketContextSummary) {
      sections.push(`\nMarket Context:`);
      if (marketContextSummary.trendSignals) {
        sections.push(
          `  Trend: ${marketContextSummary.trendSignals.trend.toUpperCase()} (${marketContextSummary.trendSignals.basis})`
        );
      }
      if (marketContextSummary.volatilitySignals) {
        sections.push(
          `  Volatility: ${marketContextSummary.volatilitySignals.volatilityLevel.toUpperCase()}${marketContextSummary.volatilitySignals.value !== undefined ? ` (${marketContextSummary.volatilitySignals.value.toFixed(2)}%)` : ''}`
        );
      }
      sections.push(
        `  Data Quality: ${marketContextSummary.dataQuality.isFresh ? 'Fresh' : 'Stale'} (source: ${marketContextSummary.dataQuality.source})`
      );
      if (
        marketContextSummary.dataQuality.issues &&
        marketContextSummary.dataQuality.issues.length > 0
      ) {
        sections.push(`    Issues: ${marketContextSummary.dataQuality.issues.join(', ')}`);
      }
    }

    // Uncertainty
    if (uncertainty.fromVision.length > 0 || uncertainty.fromMarketData.length > 0) {
      sections.push(`\nUncertainty Flags:`);
      if (uncertainty.fromVision.length > 0) {
        sections.push(`  From Vision: ${uncertainty.fromVision.join(', ')}`);
      }
      if (uncertainty.fromMarketData.length > 0) {
        sections.push(`  From Market Data: ${uncertainty.fromMarketData.join(', ')}`);
      }
    }

    sections.push('\n=== END BACKEND_CHART_CONTEXT ===');

    return sections.join('\n');
  }

  /**
   * Build journal coaching-specific system prompt.
   * Includes structured journal context and specialized coaching instructions.
   */
  buildJournalPrompt(args: {
    userMessage: string;
    conversationHistory: GroqMessage[];
    journalContext: JournalContextForLLM;
    coachingIntent: CoachingIntent;
  }): string {
    const { userMessage, conversationHistory, journalContext, coachingIntent } = args;

    const safetyRules = this.getSafetyRules();
    const journalContextBlock = this.buildJournalContextBlock(journalContext);
    const coachingGuidance = this.getCoachingGuidance(coachingIntent);

    return `You are TradionAI, a trading performance and risk coach. Your role is to analyze past trades and journal data to provide constructive, reflective coaching feedback. You DO NOT give trade signals or specific "enter now / exit now" advice. You focus on behavior, process, and risk discipline.

${safetyRules}

ROLE & SCOPE:
- You are a trading performance and risk coach
- You analyze past trades and journal data
- You DO NOT give trade signals or specific "enter now / exit now" advice
- You focus on behavior, process, and risk discipline
- This assistant is for education and performance improvement
- User remains responsible for all trading decisions

DATA CONTRACT (CRITICAL):
- The BACKEND_JOURNAL_CONTEXT below is canonical and must not be altered
- All numeric values (win rates, RR ratios, PnL, etc.) are authoritative and come from the backend
- You may reference numeric values, but never change them or fabricate new ones
- If there are data quality issues (few trades, missing fields), you must explicitly mention them and soften conclusions
- When referencing stats, copy them exactly from the context

${journalContextBlock}

COACHING STYLE:
- Identify strengths and recurring good habits
- Identify recurring mistakes, but keep language constructive
- Highlight patterns by symbol, session, timeframe, and strategy buckets
- Suggest specific reflection questions ("What was your plan when...?") rather than prescriptive trade instructions
- Tie comments to profileMetrics (e.g., typical risk per trade, typical size, avg R:R, max drawdown) when present
- Use encouraging but honest language
- Focus on process improvement, not just outcomes

${coachingGuidance}

RESPONSE STRUCTURE (REQUIRED):

You MUST structure your coaching response into six clear sections:

1. **High-Level Summary**:
   - Overall performance assessment in 2-3 sentences
   - Key metrics (win rate, avg RR, total PnL if available)
   - Time period analyzed

2. **Strengths & What's Working**:
   - What the trader is doing well
   - Positive patterns and habits
   - Areas of consistent performance

3. **Recurring Mistakes & Risks**:
   - Common errors or patterns that hurt performance
   - Risk management issues
   - Behavioral patterns that need attention
   - Keep language constructive and educational

4. **Key Patterns** (by symbol, session, timeframe, strategy):
   - Highlight notable patterns from the bucketed stats
   - Explain what these patterns might indicate
   - Reference specific buckets when relevant

5. **Suggested Adjustments**:
   - Educational suggestions for improvement
   - Process-oriented recommendations
   - Explicitly non-prescriptive (no "you must" or "you should trade X")
   - Focus on risk management, discipline, and process

6. **Reflection Questions**:
   - Thought-provoking questions to encourage self-reflection
   - Questions about specific trades or patterns
   - Questions about decision-making process
   - Questions about emotional state during trading

Remember: Always respect the data quality flags. If there are insufficient trades or missing data, explicitly acknowledge this and soften your conclusions. Never fabricate statistics or patterns not present in the BACKEND_JOURNAL_CONTEXT.`;
  }

  /**
   * Build the BACKEND_JOURNAL_CONTEXT block for LLM consumption.
   */
  private buildJournalContextBlock(journalContext: JournalContextForLLM): string {
    const {
      userId,
      window,
      overallStats,
      bySymbol,
      bySession,
      byTimeframe,
      byStrategy,
      behaviourPatterns,
      profileMetrics,
      notesSummary,
      dataQuality,
      dashboardSummary,
      dashboardPerformance,
    } = journalContext;

    const sections: string[] = [];
    sections.push('=== BACKEND_JOURNAL_CONTEXT ===');
    sections.push(`\nUser ID: ${userId}`);
    sections.push(`Analysis Window: ${window.from.toISOString()} to ${window.to.toISOString()}`);
    sections.push(`Trade Count: ${window.tradeCount}`);

    // Overall Stats
    sections.push(`\nOverall Statistics:`);
    sections.push(`  Trade Count: ${overallStats.tradeCount}`);
    sections.push(`  Win Rate: ${overallStats.winRatePct?.toFixed(1) || 'N/A'}%`);
    sections.push(`  Average RR: ${overallStats.avgRr?.toFixed(2) || 'N/A'}`);
    sections.push(`  Average PnL per Trade: $${overallStats.avgPnlUsd?.toFixed(2) || 'N/A'}`);
    sections.push(
      `  Median Risk per Trade: ${overallStats.medianRiskPerTradePct?.toFixed(2) || 'N/A'}%`
    );
    sections.push(`  Max Drawdown: ${overallStats.maxDrawdownPct?.toFixed(2) || 'N/A'}%`);

    // Dashboard Summary (net P&L, recent activity, win/loss counts, position status)
    sections.push(`\nDashboard Summary (same window):`);
    sections.push(`  Net P&L: $${dashboardSummary.netPnl.toFixed(2)}`);
    sections.push(
      `  Recent Activity — Last 7 days: $${dashboardSummary.recentActivity.pnlLast7Days.toFixed(2)}, Last 30 days: $${dashboardSummary.recentActivity.pnlLast30Days.toFixed(2)}, Current month: $${dashboardSummary.recentActivity.pnlCurrentMonth.toFixed(2)}`
    );
    sections.push(
      `  Win/Loss Stats — Winning: ${dashboardSummary.winLossStats.winningTrades}, Losing: ${dashboardSummary.winLossStats.losingTrades}, Breakeven: ${dashboardSummary.winLossStats.breakevenTrades}`
    );
    sections.push(
      `  Position Status — Open: ${dashboardSummary.positionStatus.openPositions}, Closed: ${dashboardSummary.positionStatus.closedPositions}, Partially closed: ${dashboardSummary.positionStatus.partiallyClosedPositions}`
    );
    if (dashboardSummary.monthlyPnl.length > 0) {
      sections.push(`  Monthly P&L (${dashboardSummary.monthlyPnl.length} months):`);
      dashboardSummary.monthlyPnl.slice(-12).forEach((m) => {
        sections.push(`    ${m.month}: $${m.pnl.toFixed(2)}`);
      });
    }
    if (dashboardSummary.monthlyWinRate.length > 0) {
      sections.push(`  Monthly Win Rate (last ${Math.min(12, dashboardSummary.monthlyWinRate.length)} months):`);
      dashboardSummary.monthlyWinRate.slice(-12).forEach((m) => {
        sections.push(`    ${m.month}: ${m.winRate.toFixed(1)}%`);
      });
    }

    // Dashboard Performance (risk metrics, best/worst trade)
    sections.push(`\nDashboard Performance:`);
    sections.push(
      `  Risk Metrics — Max Drawdown: ${dashboardPerformance.riskMetrics.maxDrawdown?.toFixed(2) ?? 'N/A'}%, Avg Win: $${dashboardPerformance.riskMetrics.avgWin?.toFixed(2) ?? 'N/A'}, Avg Loss: $${dashboardPerformance.riskMetrics.avgLoss?.toFixed(2) ?? 'N/A'}`
    );
    sections.push(
      `  Performance Summary — Win Rate: ${dashboardPerformance.performanceSummary.winRate?.toFixed(1) ?? 'N/A'}%, Best Trade: $${dashboardPerformance.performanceSummary.bestTrade?.toFixed(2) ?? 'N/A'}, Worst Trade: $${dashboardPerformance.performanceSummary.worstTrade?.toFixed(2) ?? 'N/A'}`
    );

    // Profile Metrics
    if (profileMetrics) {
      sections.push(`\nProfile Metrics:`);
      sections.push(
        `  Typical Risk per Trade: ${profileMetrics.typicalRiskPerTradePct.toFixed(2)}%`
      );
      sections.push(
        `  Typical Position Size: $${profileMetrics.typicalPositionSizeUsd.toFixed(2)}`
      );
      sections.push(`  Average RR Ratio: ${profileMetrics.avgRrRatio?.toFixed(2) || 'N/A'}`);
      sections.push(`  Max Drawdown: ${profileMetrics.maxDrawdownPct?.toFixed(2) || 'N/A'}%`);
    } else {
      sections.push(`\nProfile Metrics: Not available (insufficient trade history)`);
    }

    // By Symbol
    if (bySymbol.length > 0) {
      sections.push(`\nStatistics by Symbol (${bySymbol.length} symbols):`);
      bySymbol.slice(0, 10).forEach((bucket) => {
        sections.push(
          `  ${bucket.key.symbol || 'Unknown'}: ${bucket.tradeCount} trades, ${bucket.winRatePct?.toFixed(1) || 'N/A'}% win rate, $${bucket.avgPnlUsd?.toFixed(2) || 'N/A'} avg PnL`
        );
      });
    }

    // By Session
    if (bySession.length > 0) {
      sections.push(`\nStatistics by Session (${bySession.length} sessions):`);
      bySession.forEach((bucket) => {
        sections.push(
          `  ${bucket.key.sessionLabel || 'Unknown'}: ${bucket.tradeCount} trades, ${bucket.winRatePct?.toFixed(1) || 'N/A'}% win rate, $${bucket.avgPnlUsd?.toFixed(2) || 'N/A'} avg PnL`
        );
      });
    }

    // By Timeframe
    if (byTimeframe.length > 0) {
      sections.push(`\nStatistics by Timeframe (${byTimeframe.length} timeframes):`);
      byTimeframe.forEach((bucket) => {
        sections.push(
          `  ${bucket.key.timeframe || 'Unknown'}: ${bucket.tradeCount} trades, ${bucket.winRatePct?.toFixed(1) || 'N/A'}% win rate, $${bucket.avgPnlUsd?.toFixed(2) || 'N/A'} avg PnL`
        );
      });
    }

    // By Strategy
    if (byStrategy.length > 0) {
      sections.push(`\nStatistics by Strategy (${byStrategy.length} strategies):`);
      byStrategy.forEach((bucket) => {
        sections.push(
          `  ${bucket.key.strategyTag || 'Unknown'}: ${bucket.tradeCount} trades, ${bucket.winRatePct?.toFixed(1) || 'N/A'}% win rate, $${bucket.avgPnlUsd?.toFixed(2) || 'N/A'} avg PnL`
        );
      });
    }

    // Behaviour Patterns
    if (behaviourPatterns.length > 0) {
      sections.push(`\nDetected Behaviour Patterns (${behaviourPatterns.length}):`);
      behaviourPatterns.forEach((pattern) => {
        sections.push(`  [${pattern.type.toUpperCase()}] ${pattern.description}`);
        sections.push(`    Evidence: ${pattern.evidenceTrades.length} trades`);
      });
    } else {
      sections.push(`\nDetected Behaviour Patterns: None detected`);
    }

    // Notes Summary
    if (notesSummary) {
      sections.push(`\nJournal Entry Notes:`);
      sections.push(`  Total Entries: ${notesSummary.totalEntries}`);
      if (notesSummary.commonThemes.length > 0) {
        sections.push(`  Common Themes: ${notesSummary.commonThemes.join(', ')}`);
      }
    }

    // Data Quality
    sections.push(`\nData Quality:`);
    sections.push(
      `  Enough Trades: ${dataQuality.enoughTrades ? 'Yes' : 'No'} (${dataQuality.tradesConsidered} trades)`
    );
    if (dataQuality.missingFields.length > 0) {
      sections.push(`  Missing Fields: ${dataQuality.missingFields.join(', ')}`);
    } else {
      sections.push(`  Missing Fields: None`);
    }

    sections.push('\n=== END BACKEND_JOURNAL_CONTEXT ===');

    return sections.join('\n');
  }

  /**
   * Get coaching guidance specific to coaching intent.
   */
  private getCoachingGuidance(coachingIntent: CoachingIntent): string {
    const guidance: Record<CoachingIntent, string> = {
      overview: `COACHING INTENT: OVERVIEW
- Provide a comprehensive analysis covering all aspects of trading performance
- Cover all six response sections thoroughly
- Give equal weight to strengths, weaknesses, and patterns
- Provide a balanced assessment of overall performance`,

      recent_performance: `COACHING INTENT: RECENT PERFORMANCE
- Focus on the most recent trading period (last 30 days)
- Highlight changes vs baseline or historical performance
- Emphasize recent trends and patterns
- Discuss what's working recently and what's not
- Pay attention to recent sequence of wins/losses`,

      pattern_detection: `COACHING INTENT: PATTERN DETECTION
- Emphasize recurring edges and mistakes with concrete stats
- Deep dive into the detected behaviour patterns
- Highlight patterns by symbol, session, timeframe, and strategy
- Use specific examples from the bucketed stats
- Focus on identifying what patterns are driving performance`,

      risk_discipline: `COACHING INTENT: RISK DISCIPLINE
- Focus heavily on risk management metrics
- Compare actual risk per trade vs typical risk per trade
- Discuss RR ratio management and consistency
- Highlight any risk-related behaviour patterns
- Tie closely to Risk Engine metrics if available
- Emphasize position sizing and stop loss discipline`,

      emotional_control: `COACHING INTENT: EMOTIONAL CONTROL
- Emphasize sequences of losses and drawdowns
- Highlight revenge-trade patterns if detected
- Discuss emotional patterns from journal notes
- Focus on coping mechanisms (non-medical, non-therapeutic)
- Address overtrading and emotional decision-making
- Keep language at "trading behavior" level, not therapeutic`,
    };

    return guidance[coachingIntent];
  }

  /**
   * Build sentiment-specific system prompt.
   * Includes structured sentiment context and specialized instructions.
   */
  private buildSentimentPrompt(args: {
    userLevel: UserLevel;
    intents: Intent[];
    primaryIntent: Intent;
    marketContext?: MarketContext;
    sentimentContext: import('../sentiment/sentimentTypes').SentimentContextForLLM;
  }): string {
    const { userLevel, intents, primaryIntent, marketContext, sentimentContext } = args;

    const safetyRules = this.getSafetyRules();
    const toneGuidance = this.getToneGuidance(userLevel, intents, primaryIntent);
    const marketContextSection = this.buildMarketContextSection(marketContext);
    const sentimentContextBlock = this.buildSentimentContextBlock(sentimentContext);
    const intentGuidance = this.getMultiIntentGuidance(intents, primaryIntent);

    return `You are TradionAI, a market sentiment explainer. Your role is to summarize and contextualize numeric sentiment scores and drivers. You DO NOT give direct trade recommendations or guaranteed predictions. You emphasize that sentiment is context, not a trading signal by itself.

${safetyRules}

ROLE & SCOPE:
- You are a market sentiment explainer
- You summarize and contextualize numeric sentiment scores and drivers
- You DO NOT give direct trade recommendations or guaranteed predictions
- You emphasize that sentiment is context, not a trading signal by itself
- This assistant is for education and market awareness
- User remains responsible for all trading decisions

DATA CONTRACT (CRITICAL):
- The BACKEND_SENTIMENT_CONTEXT below is canonical and must not be altered
- All numeric values (aggregate.score, direction, confidence, etc.) are authoritative and come from the backend
- You may restate numbers, but never fabricate new scores
- You must mention data-quality caveats when confidence is low or data is sparse/stale
- When referencing sentiment metrics, copy them exactly from the context

${sentimentContextBlock}

${toneGuidance}

${intentGuidance}

${marketContextSection}

RESPONSE STRUCTURE (REQUIRED):

You MUST structure your sentiment response into four clear sections:

1. **Sentiment Overview**:
   - Overall direction (bullish/bearish/neutral) and strength in 2-3 sentences
   - Aggregate score and confidence level
   - How reliable the snapshot is based on data quality

2. **What's Driving This**:
   - Bullet points from drivers and by-source stats
   - Which sources are contributing (news/social/research)
   - Key themes or events driving sentiment

Additional formatting rules for sentiment drivers:
- When talking about drivers, DO NOT mention internal IDs (e.g. fear_greed_index or price_action).
- Refer to drivers using the natural phrases from the context (e.g. "Crypto Fear & Greed index", "recent price action").
- DO NOT quote raw numeric weights. Describe drivers qualitatively (e.g. "main driver", "supporting factor").
- When relevant, briefly explain why one driver dominates another (e.g. a strongly negative Fear & Greed reading outweighing a mildly positive price-action signal).

3. **Reliability & Limitations**:
   - Use dataQuality to describe:
     - Low signal count (if applicable)
     - Source concentration (if applicable)
     - Stale data (if applicable)
   - Confidence level and what it means
   - What information is missing or uncertain

4. **How to Use This (Educational)**:
   - General guidance on using sentiment as context (not as a standalone signal)
   - Emphasize that sentiment can diverge from price and fundamentals
   - Remind that sentiment is one factor among many
   - No direct trade advice

Remember: Always respect the data quality flags. If confidence is low or data is sparse/stale, explicitly state this in your response. Never fabricate sentiment scores or drivers not present in the BACKEND_SENTIMENT_CONTEXT.`;
  }

  /**
   * Build the BACKEND_SENTIMENT_CONTEXT block for LLM consumption.
   */
  private buildSentimentContextBlock(
    sentimentContext: import('../sentiment/sentimentTypes').SentimentContextForLLM
  ): string {
    const { symbol, baseAssetClass, windowDescription, aggregate, drivers, rawStats, dataQuality } =
      sentimentContext;

    const sections: string[] = [];
    sections.push('=== BACKEND_SENTIMENT_CONTEXT ===');
    sections.push(`\nSymbol: ${symbol}`);
    if (baseAssetClass) {
      sections.push(`Asset Class: ${baseAssetClass}`);
    }
    sections.push(`Window: ${windowDescription}`);

    // Aggregate
    if (aggregate) {
      sections.push(`\nAggregate:`);
      sections.push(`  Score: ${aggregate.score.toFixed(3)} (range: -1.0 to 1.0)`);
      sections.push(`  Direction: ${aggregate.direction.toUpperCase()}`);
      sections.push(`  Confidence: ${(aggregate.confidence * 100).toFixed(1)}%`);
      sections.push(`  Signals Used: ${aggregate.signalsUsed}`);
      sections.push(`  Sources: ${aggregate.sourcesUsed.join(', ')}`);
    } else {
      sections.push(`\nAggregate: No aggregate available (insufficient signals)`);
    }

    // Drivers: user-facing label and qualitative importance only (no id, no raw weight)
    if (drivers.length > 0) {
      sections.push(`\nTop Drivers (${drivers.length}):`);
      drivers.forEach((driver, idx) => {
        const importance =
          driver.weight >= 3 ? 'primary driver' :
          driver.weight >= 1 ? 'important factor' :
          'minor factor';
        sections.push(
          `  ${idx + 1}. ${driver.label} – ${importance}. ${driver.explanation}`
        );
      });
    } else {
      sections.push(`\nTop Drivers: None identified`);
    }

    // By-source stats: map internal source ids to user-facing names
    const SOURCE_TO_USER_LABEL: Record<string, string> = {
      price_action: 'Price action',
      crypto_fear_greed: 'Crypto Fear & Greed',
      alpha_vantage_news: 'News sentiment',
      finnhub_general_news: 'General news',
      finnhub_equity_news: 'Equity news',
    };
    if (rawStats.bySource.length > 0) {
      sections.push(`\nBy Source:`);
      rawStats.bySource.forEach((stat) => {
        const sourceLabel = SOURCE_TO_USER_LABEL[stat.source] ?? stat.source;
        sections.push(
          `  ${sourceLabel}: avg score ${stat.avgScore.toFixed(3)}, ${stat.signals} signal${stat.signals !== 1 ? 's' : ''}`
        );
      });
    }

    if (rawStats.latestTimestamp) {
      sections.push(`\nLatest Signal: ${rawStats.latestTimestamp.toISOString()}`);
    }

    // Data Quality
    sections.push(`\nData Quality:`);
    sections.push(`  Has Enough Signals: ${dataQuality.hasEnoughSignals ? 'Yes' : 'No'}`);
    sections.push(`  Signals Available: ${dataQuality.signalsAvailable}`);
    sections.push(`  Sources Available: ${dataQuality.sourcesAvailable.join(', ') || 'None'}`);
    sections.push(`  Is Fresh: ${dataQuality.isFresh ? 'Yes' : 'No'}`);
    if (dataQuality.issues.length > 0) {
      sections.push(`  Issues: ${dataQuality.issues.join(', ')}`);
    } else {
      sections.push(`  Issues: None`);
    }

    sections.push('\n=== END BACKEND_SENTIMENT_CONTEXT ===');

    return sections.join('\n');
  }
}

// Export singleton instance
export const promptBuilder = new PromptBuilder();
