import { Op } from 'sequelize';
import type { GroqMessage } from '../ai/groqCompoundClient';
import type { MarketContext } from '../../types/market';
import { getUserProfileMetrics, recomputeUserProfileMetrics } from '../profile/profileService';
import { marketContextService } from '../market/marketContextService';
import { evaluateTradeRisk } from './riskEngine';
import { defaultRiskPolicyConfig } from './riskPolicy';
import type {
  UserContext,
  AccountState,
  TradeIntent,
  MarketSnapshot,
  RiskEvaluationRequest,
  RiskEvaluationResult,
  RiskProfile,
  ExperienceLevel,
  Timeframe,
  OrderType,
  TradeSide,
} from './riskTypes';
import type { UserProfileMetrics } from '../profile/profileTypes';
import { User } from '../../db/models/User';
import { MetaApiAccount } from '../../db/models/MetaApiAccount';
import { AccountEquitySnapshot } from '../../db/models/AccountEquitySnapshot';
import { TradingPosition } from '../../db/models/TradingPosition';
import { groqCompoundClient } from '../ai/groqCompoundClient';
import { logger } from '../../config/logger';

/**
 * Risk context structure passed to LLM for risk-related conversations.
 * Contains all ground-truth data needed for risk evaluation and explanation.
 */
export interface RiskContextForLLM {
  userContext: UserContext;
  accountStateSummary: {
    equityUsd: number;
    availableMarginUsd: number;
    openRiskUsd: number;
    openPositionsCount: number;
  };
  profileMetrics: UserProfileMetrics | null;
  marketSnapshot: MarketSnapshot;
  riskEvaluation: RiskEvaluationResult | null; // null if missing fields
  missingFields: string[]; // e.g. ["stopPrice", "quantity"]
}

/**
 * Risk orchestrator service.
 * Orchestrates risk evaluation by gathering context from multiple services
 * and building RiskContextForLLM for LLM consumption.
 */
export class RiskOrchestrator {
  /**
   * Build risk context for a user message.
   * Gathers all ground-truth data and evaluates risk if trade intent is complete.
   */
  async buildRiskContext(
    userId: string,
    message: string,
    conversationHistory: GroqMessage[] = [],
    marketContext?: MarketContext
  ): Promise<RiskContextForLLM> {
    try {
      // Step 1: Gather user context
      const userContext = await this.buildUserContext(userId);

      // Step 2: Gather profile metrics
      const profileMetrics = await this.getOrRecomputeProfileMetrics(userId);

      // Step 3: Gather account state
      const accountStateSummary = await this.buildAccountStateSummary(userId);

      // Step 4: Get or build market snapshot
      const marketSnapshot = await this.buildMarketSnapshot(message, marketContext);

      // Step 5: Parse trade intent from message
      const tradeIntent = await this.parseTradeIntentFromMessage(
        message,
        conversationHistory,
        marketContext
      );

      // Step 6: Detect missing fields
      const missingFields = this.detectMissingFields(tradeIntent);

      // Step 7: If all required fields present, evaluate risk
      let riskEvaluation: RiskEvaluationResult | null = null;
      if (missingFields.length === 0 && tradeIntent) {
        const evaluationRequest: RiskEvaluationRequest = {
          userContext,
          accountState: {
            accountId: '', // Will be set from account state if available
            equityUsd: accountStateSummary.equityUsd,
            availableMarginUsd: accountStateSummary.availableMarginUsd,
            openRiskUsd: accountStateSummary.openRiskUsd,
            openPositions: [], // Can be enriched from TradingPosition if needed
          },
          tradeIntent: tradeIntent as TradeIntent,
          marketSnapshot,
        };

        riskEvaluation = evaluateTradeRisk(evaluationRequest, defaultRiskPolicyConfig);
      }

      return {
        userContext,
        accountStateSummary,
        profileMetrics,
        marketSnapshot,
        riskEvaluation,
        missingFields,
      };
    } catch (error) {
      logger.error('Risk orchestrator error', {
        error: (error as Error).message,
        userId,
        stack: (error as Error).stack,
      });

      // Return minimal context on error
      const userContext = await this.buildUserContext(userId);
      const accountStateSummary = await this.buildAccountStateSummary(userId);
      const marketSnapshot = await this.buildMarketSnapshot(message, marketContext);

      return {
        userContext,
        accountStateSummary,
        profileMetrics: null,
        marketSnapshot,
        riskEvaluation: null,
        missingFields: ['error'], // Signal error state
      };
    }
  }

  /**
   * Build user context from User model and profile metrics.
   * Uses defaults if riskProfile/experienceLevel not in User model.
   */
  private async buildUserContext(userId: string): Promise<UserContext> {
    const user = await User.findByPk(userId);
    const profileMetrics = await getUserProfileMetrics(userId);

    // Default risk profile and experience level (can be enhanced with User model fields later)
    const riskProfile: RiskProfile = 'moderate'; // Default
    const experienceLevel: ExperienceLevel = 'intermediate'; // Default

    return {
      userId,
      riskProfile,
      experienceLevel,
      typicalRiskPerTradePct: profileMetrics?.typicalRiskPerTradePct || 0.5,
      typicalPositionSizeUsd: profileMetrics?.typicalPositionSizeUsd || 0,
    };
  }

  /**
   * Get profile metrics, recomputing if stale (> 7 days).
   */
  private async getOrRecomputeProfileMetrics(
    userId: string
  ): Promise<UserProfileMetrics | null> {
    const metrics = await getUserProfileMetrics(userId);

    if (!metrics) {
      // No metrics yet, try to recompute
      try {
        return await recomputeUserProfileMetrics({ userId });
      } catch (error) {
        logger.warn('Failed to recompute profile metrics', {
          userId,
          error: (error as Error).message,
        });
        return null;
      }
    }

    // Check if stale (> 7 days)
    const ageDays = (Date.now() - metrics.lastComputedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 7) {
      try {
        return await recomputeUserProfileMetrics({ userId });
      } catch (error) {
        logger.warn('Failed to recompute stale profile metrics', {
          userId,
          ageDays,
          error: (error as Error).message,
        });
        // Return stale metrics rather than null
        return metrics;
      }
    }

    return metrics;
  }

  /**
   * Build account state summary from latest equity snapshot and open positions.
   */
  private async buildAccountStateSummary(userId: string): Promise<{
    equityUsd: number;
    availableMarginUsd: number;
    openRiskUsd: number;
    openPositionsCount: number;
  }> {
    // Get user's MetaApi accounts
    const accounts = await MetaApiAccount.findAll({
      where: { userId, isActive: true },
      attributes: ['id'],
    });

    if (accounts.length === 0) {
      return {
        equityUsd: 0,
        availableMarginUsd: 0,
        openRiskUsd: 0,
        openPositionsCount: 0,
      };
    }

    const accountIds = accounts.map((acc) => acc.id);

    // Get latest equity snapshot for each account
    const latestSnapshots = await Promise.all(
      accountIds.map(async (accountId) => {
        const snapshot = await AccountEquitySnapshot.findOne({
          where: { accountId },
          order: [['takenAt', 'DESC']],
        });
        return snapshot;
      })
    );

    // Aggregate equity and margin
    let totalEquity = 0;
    let totalAvailableMargin = 0;

    for (const snapshot of latestSnapshots) {
      if (snapshot?.equity != null) {
        totalEquity += Number(snapshot.equity);
      }
      if (snapshot?.freeMargin != null) {
        totalAvailableMargin += Number(snapshot.freeMargin);
      }
    }

    // Get open positions and calculate open risk
    const openPositions = await TradingPosition.findAll({
      where: { accountId: { [Op.in]: accountIds } },
    });

    let totalOpenRisk = 0;
    for (const position of openPositions) {
      if (position.priceOpen != null && position.sl != null && position.volume != null) {
        const riskPerPosition = Math.abs(Number(position.priceOpen) - Number(position.sl)) * Number(position.volume);
        totalOpenRisk += riskPerPosition;
      }
    }

    return {
      equityUsd: totalEquity,
      availableMarginUsd: totalAvailableMargin,
      openRiskUsd: totalOpenRisk,
      openPositionsCount: openPositions.length,
    };
  }

  /**
   * Build market snapshot from MarketContext or fetch from marketContextService.
   */
  private async buildMarketSnapshot(
    message: string,
    marketContext?: MarketContext
  ): Promise<MarketSnapshot> {
    // If we have market context, use it
    if (marketContext?.priceSnapshot) {
      return {
        symbol: marketContext.instrument.symbol,
        currentPrice: marketContext.priceSnapshot.last,
        sessionVolatilityPct: marketContext.volatilitySignals?.value || null,
        // Other fields can be enriched from market context if available
        atr: null,
        tickSize: null,
        minNotional: null,
        maxLeverageAllowed: null,
      };
    }

    // Try to get market context from service
    try {
      const result = await marketContextService.getContext({
        rawQuery: message,
      });

      if (result.contextAvailable && result.context?.priceSnapshot) {
        return {
          symbol: result.context.instrument.symbol,
          currentPrice: result.context.priceSnapshot.last,
          sessionVolatilityPct: result.context.volatilitySignals?.value || null,
          atr: null,
          tickSize: null,
          minNotional: null,
          maxLeverageAllowed: null,
        };
      }
    } catch (error) {
      logger.warn('Failed to get market context for snapshot', {
        error: (error as Error).message,
      });
    }

    // Fallback: minimal snapshot (will need symbol/price from trade intent parsing)
    return {
      symbol: '',
      currentPrice: 0,
      atr: null,
      tickSize: null,
      minNotional: null,
      maxLeverageAllowed: null,
      sessionVolatilityPct: null,
    };
  }

  /**
   * Parse trade intent from user message using LLM-assisted structured parsing.
   * Returns partial TradeIntent with extracted fields.
   */
  private async parseTradeIntentFromMessage(
    message: string,
    conversationHistory: GroqMessage[] = [],
    marketContext?: MarketContext
  ): Promise<Partial<TradeIntent> | null> {
    try {
      const systemPrompt = `You are a trade intent parser. Extract trading information from the user's message and return it as JSON.

Extract the following fields if mentioned:
- symbol: Trading symbol (e.g., "EURUSD", "BTC", "AAPL")
- side: "long" or "short"
- entryPrice: Entry price (number)
- stopPrice: Stop loss price (number)
- targetPrice: Take profit/target price (number, optional)
- quantity: Position size/quantity (number)
- leverage: Leverage amount (number, optional)
- timeframe: One of "scalp", "intraday", "swing", "position"
- orderType: "market" or "limit" (default: "market")

If a field is not mentioned, omit it from the JSON.

Return ONLY valid JSON in this format:
{
  "symbol": "EURUSD",
  "side": "long",
  "entryPrice": 1.1000,
  "stopPrice": 1.0950,
  "targetPrice": 1.1100,
  "quantity": 0.1,
  "leverage": 10,
  "timeframe": "intraday",
  "orderType": "market"
}`;

      const contextInfo = marketContext
        ? `\n\nMarket context: Symbol ${marketContext.instrument.symbol}, current price ${marketContext.priceSnapshot?.last || 'unknown'}`
        : '';

      const userMessage = `User message: ${message}${contextInfo}\n\nExtract trade intent as JSON.`;

      const response = await groqCompoundClient.completeChat({
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory.slice(-3), // Last 3 messages for context
          { role: 'user', content: userMessage },
        ],
        maxTokens: 500,
        temperature: 0.3,
        responseFormat: { type: 'json_object' },
      });

      const content = response.content.trim();
      let parsed: Partial<TradeIntent>;

      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        // Try to extract JSON from text
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          logger.warn('Failed to parse trade intent JSON', { content });
          return null;
        }
      }

      // Validate and normalize
      const tradeIntent: Partial<TradeIntent> = {};

      if (parsed.symbol && typeof parsed.symbol === 'string') {
        tradeIntent.symbol = parsed.symbol.toUpperCase();
      }
      if (parsed.side === 'long' || parsed.side === 'short') {
        tradeIntent.side = parsed.side;
      }
      if (typeof parsed.entryPrice === 'number' && parsed.entryPrice > 0) {
        tradeIntent.entryPrice = parsed.entryPrice;
      }
      if (typeof parsed.stopPrice === 'number' && parsed.stopPrice > 0) {
        tradeIntent.stopPrice = parsed.stopPrice;
      }
      if (typeof parsed.targetPrice === 'number' && parsed.targetPrice > 0) {
        tradeIntent.targetPrice = parsed.targetPrice;
      }
      if (typeof parsed.quantity === 'number' && parsed.quantity > 0) {
        tradeIntent.quantity = parsed.quantity;
      }
      if (typeof parsed.leverage === 'number' && parsed.leverage > 0) {
        tradeIntent.leverage = parsed.leverage;
      }
      if (
        parsed.timeframe === 'scalp' ||
        parsed.timeframe === 'intraday' ||
        parsed.timeframe === 'swing' ||
        parsed.timeframe === 'position'
      ) {
        tradeIntent.timeframe = parsed.timeframe;
      }
      if (parsed.orderType === 'market' || parsed.orderType === 'limit') {
        tradeIntent.orderType = parsed.orderType;
      } else {
        tradeIntent.orderType = 'market'; // Default
      }

      return tradeIntent;
    } catch (error) {
      logger.error('Trade intent parsing failed', {
        error: (error as Error).message,
        message: message.substring(0, 100),
      });
      return null;
    }
  }

  /**
   * Detect missing required fields in trade intent.
   * Required: symbol, side, entryPrice, stopPrice, quantity, timeframe
   * Optional: targetPrice, leverage, orderType
   */
  detectMissingFields(tradeIntent: Partial<TradeIntent> | null): string[] {
    if (!tradeIntent) {
      return ['symbol', 'side', 'entryPrice', 'stopPrice', 'quantity', 'timeframe'];
    }

    const missing: string[] = [];

    if (!tradeIntent.symbol) missing.push('symbol');
    if (!tradeIntent.side) missing.push('side');
    if (!tradeIntent.entryPrice || tradeIntent.entryPrice <= 0) missing.push('entryPrice');
    if (!tradeIntent.stopPrice || tradeIntent.stopPrice <= 0) missing.push('stopPrice');
    if (!tradeIntent.quantity || tradeIntent.quantity <= 0) missing.push('quantity');
    if (!tradeIntent.timeframe) missing.push('timeframe');

    return missing;
  }

  /**
   * Compute maximum quantity for a given risk limit (deterministic helper).
   * maxQuantity = maxRiskUsd / |entryPrice - stopPrice|
   */
  computeMaxQuantityForRiskLimit(
    entryPrice: number,
    stopPrice: number,
    maxRiskUsd: number
  ): number {
    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    if (riskPerUnit <= 0) return 0;
    return maxRiskUsd / riskPerUnit;
  }

  /**
   * Compute stop price for a given risk limit and quantity (deterministic helper).
   * stopPrice = entryPrice ± (maxRiskUsd / quantity)
   * Sign depends on side (long: entryPrice - risk, short: entryPrice + risk)
   */
  computeStopForRiskLimit(
    entryPrice: number,
    quantity: number,
    maxRiskUsd: number,
    side: 'long' | 'short'
  ): number {
    if (quantity <= 0) return entryPrice;
    const riskPerUnit = maxRiskUsd / quantity;

    if (side === 'long') {
      return entryPrice - riskPerUnit;
    } else {
      return entryPrice + riskPerUnit;
    }
  }
}

// Export singleton instance
export const riskOrchestrator = new RiskOrchestrator();
