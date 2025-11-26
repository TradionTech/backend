import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { chatController } from '../controllers/chat.controller';

const router = Router();

const ChatSchema = Joi.object({
  session_id: Joi.string().uuid().required(),
  message: Joi.string().max(500).required(),
  message_type: Joi.string().valid('text').default('text'),
});

router.post('/', authGuard(), validateBody(ChatSchema), chatController.postChat);

export default router;
