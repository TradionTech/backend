import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { riskController } from '../controllers/risk.controller.js';

const router = Router();

const RiskSchema = Joi.object({
  account_balance: Joi.number().positive().required(),
  risk_percent: Joi.number().min(0.1).max(100).required(),
  entry: Joi.number().required(),
  stop_loss: Joi.number().required(),
  take_profit: Joi.number().optional(),
  symbol: Joi.string().required()
});

router.post('/calculate', authGuard(), validateBody(RiskSchema), riskController.calculate);

export default router;

