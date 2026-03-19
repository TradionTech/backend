import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { signalController } from '../controllers/signal.controller';

const router = Router();

const SignalConfirmSchema = Joi.object({
  symbol: Joi.string().required(),
  entry: Joi.number().positive().required(),
  take_profit: Joi.number().positive().required(),
  stop_loss: Joi.number().positive().required(),
  trade_type: Joi.string().valid('buy', 'sell', 'long', 'short').required(),
});

router.post('/', authGuard(), validateBody(SignalConfirmSchema), signalController.confirmSignal);

export default router;

