import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { chatController } from '../controllers/chat.controller';

const router = Router();

const ChatSchema = Joi.object({
  session_id: Joi.string().uuid().optional(),
  message: Joi.string().max(2000).required(),
  message_type: Joi.string().valid('text').default('text'),
  /** Optional model id for chat completion (must be allowed for user's plan). */
  model_id: Joi.string().optional(),
  metadata: Joi.object({
    instrument: Joi.string().optional(),
    timeframe: Joi.string().optional(),
    chartId: Joi.string().uuid().optional(),
  }).optional(),
  /** Optional array of images for chart analysis: base64 strings or data URLs (data:image/...;base64,...). First image is used. Max 10. */
  images: Joi.array().items(Joi.string()).max(10).optional(),
});

router.post('/', authGuard(), validateBody(ChatSchema), chatController.postChat);
router.post('/no-stream', authGuard(), validateBody(ChatSchema), chatController.postChatNoStream);

export default router;
