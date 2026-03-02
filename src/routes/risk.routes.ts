import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { riskController } from '../controllers/risk.controller';

const router = Router();

const RiskSchema = Joi.object({
  account_balance: Joi.number().positive().required(),
  risk_percent: Joi.number().min(0.1).max(100).required(),
  entry: Joi.number().required(),
  stop_loss: Joi.number().required(),
  take_profit: Joi.number().optional(),
  symbol: Joi.string().required(),
});

const RiskEvaluationRequestSchema = Joi.object({
  userContext: Joi.object({
    userId: Joi.string().required(),
    riskProfile: Joi.string().valid('conservative', 'moderate', 'aggressive').required(),
    experienceLevel: Joi.string().valid('novice', 'intermediate', 'advanced').required(),
    typicalRiskPerTradePct: Joi.number().min(0).required(),
    typicalPositionSizeUsd: Joi.number().min(0).required(),
  }).required(),
  accountState: Joi.object({
    accountId: Joi.string().required(),
    equityUsd: Joi.number().min(0).required(),
    availableMarginUsd: Joi.number().required(),
    openRiskUsd: Joi.number().min(0).required(),
    openPositions: Joi.array().items(
      Joi.object({
        symbol: Joi.string().required(),
        riskUsd: Joi.number().min(0).required(),
      })
    ).required(),
  }).required(),
  tradeIntent: Joi.object({
    symbol: Joi.string().required(),
    side: Joi.string().valid('long', 'short').required(),
    entryPrice: Joi.number().positive().required(),
    stopPrice: Joi.number().positive().required(),
    targetPrice: Joi.number().positive().allow(null).optional(),
    quantity: Joi.number().positive().required(),
    leverage: Joi.number().positive().allow(null).optional(),
    timeframe: Joi.string().valid('scalp', 'intraday', 'swing', 'position').required(),
    orderType: Joi.string().valid('market', 'limit').required(),
  }).required(),
  marketSnapshot: Joi.object({
    symbol: Joi.string().required(),
    currentPrice: Joi.number().positive().required(),
    atr: Joi.number().positive().allow(null).optional(),
    tickSize: Joi.number().positive().allow(null).optional(),
    minNotional: Joi.number().positive().allow(null).optional(),
    maxLeverageAllowed: Joi.number().positive().allow(null).optional(),
    sessionVolatilityPct: Joi.number().allow(null).optional(),
  }).required(),
});

router.post('/calculate', authGuard(), validateBody(RiskSchema), riskController.calculate);
router.post('/evaluate', authGuard(), validateBody(RiskEvaluationRequestSchema), riskController.evaluateTradeRiskHandler);

export default router;
