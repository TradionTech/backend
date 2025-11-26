import { Router } from 'express';
import { authGuard } from '../middleware/auth.js';
import { sentimentController } from '../controllers/sentiment.controller.js';

const router = Router();
router.get('/', authGuard(), sentimentController.getSentiment);
export default router;

