/**
 * Tool definitions for future Groq/Compound tool calling integration.
 * 
 * These tools are prepared but not enabled by default. When enabled, they will
 * call existing services (riskEngine, profileService, marketContextService) under the hood.
 * 
 * This is a future enhancement - the current implementation uses orchestrator-driven calls
 * rather than LLM tool calling.
 */

import type { RiskEvaluationRequest, RiskEvaluationResult } from '../../risk/riskTypes';
import type { UserProfileMetrics } from '../../profile/profileTypes';
import type { MarketSnapshot } from '../../risk/riskTypes';

/**
 * Tool descriptor for risk engine evaluation.
 * Follows OpenAI tools schema format.
 */
export const riskEngineEvaluateTradeTool = {
  type: 'function' as const,
  function: {
    name: 'risk_engine.evaluate_trade',
    description: 'Evaluate trade risk using the risk engine. Returns risk metrics and policy flags.',
    parameters: {
      type: 'object',
      properties: {
        userContext: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            riskProfile: { type: 'string', enum: ['conservative', 'moderate', 'aggressive'] },
            experienceLevel: { type: 'string', enum: ['novice', 'intermediate', 'advanced'] },
            typicalRiskPerTradePct: { type: 'number' },
            typicalPositionSizeUsd: { type: 'number' },
          },
          required: ['userId', 'riskProfile', 'experienceLevel', 'typicalRiskPerTradePct', 'typicalPositionSizeUsd'],
        },
        accountState: {
          type: 'object',
          properties: {
            accountId: { type: 'string' },
            equityUsd: { type: 'number' },
            availableMarginUsd: { type: 'number' },
            openRiskUsd: { type: 'number' },
            openPositions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  symbol: { type: 'string' },
                  riskUsd: { type: 'number' },
                },
              },
            },
          },
          required: ['accountId', 'equityUsd', 'availableMarginUsd', 'openRiskUsd', 'openPositions'],
        },
        tradeIntent: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            side: { type: 'string', enum: ['long', 'short'] },
            entryPrice: { type: 'number' },
            stopPrice: { type: 'number' },
            targetPrice: { type: 'number', nullable: true },
            quantity: { type: 'number' },
            leverage: { type: 'number', nullable: true },
            timeframe: { type: 'string', enum: ['scalp', 'intraday', 'swing', 'position'] },
            orderType: { type: 'string', enum: ['market', 'limit'] },
          },
          required: ['symbol', 'side', 'entryPrice', 'stopPrice', 'quantity', 'timeframe', 'orderType'],
        },
        marketSnapshot: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            currentPrice: { type: 'number' },
            atr: { type: 'number', nullable: true },
            tickSize: { type: 'number', nullable: true },
            minNotional: { type: 'number', nullable: true },
            maxLeverageAllowed: { type: 'number', nullable: true },
            sessionVolatilityPct: { type: 'number', nullable: true },
          },
          required: ['symbol', 'currentPrice'],
        },
      },
      required: ['userContext', 'accountState', 'tradeIntent', 'marketSnapshot'],
    },
  },
};

/**
 * Tool descriptor for getting user profile metrics.
 */
export const profileGetUserProfileTool = {
  type: 'function' as const,
  function: {
    name: 'profile.get_user_profile',
    description: 'Get user profile metrics including typical risk per trade, position size, RR ratio, and drawdown.',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
      },
      required: ['userId'],
    },
  },
};

/**
 * Tool descriptor for getting market snapshot.
 */
export const marketGetSnapshotTool = {
  type: 'function' as const,
  function: {
    name: 'market.get_snapshot',
    description: 'Get current market snapshot including price, volatility, and instrument details.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        timeframeHint: { type: 'string' },
      },
      required: ['symbol'],
    },
  },
};

/**
 * All risk-related tools (for future use).
 */
export const riskTools = [
  riskEngineEvaluateTradeTool,
  profileGetUserProfileTool,
  marketGetSnapshotTool,
];

/**
 * Tool handler implementations (for future use when tool calling is enabled).
 * These would be called by groqCompoundClient when the LLM requests tool execution.
 */
export const riskToolHandlers = {
  'risk_engine.evaluate_trade': async (args: RiskEvaluationRequest): Promise<RiskEvaluationResult> => {
    // This would call evaluateTradeRisk from riskEngine
    // Implementation would be added when tool calling is enabled
    throw new Error('Tool calling not yet enabled');
  },
  'profile.get_user_profile': async (args: { userId: string }): Promise<UserProfileMetrics | null> => {
    // This would call getUserProfileMetrics from profileService
    // Implementation would be added when tool calling is enabled
    throw new Error('Tool calling not yet enabled');
  },
  'market.get_snapshot': async (args: { symbol: string; timeframeHint?: string }): Promise<MarketSnapshot> => {
    // This would call marketContextService and convert to MarketSnapshot
    // Implementation would be added when tool calling is enabled
    throw new Error('Tool calling not yet enabled');
  },
};
