import { Router } from 'express';
import { authGuard } from '../middleware/auth';
import { sentimentController } from '../controllers/sentiment.controller';

const router = Router();
router.get('/', authGuard(), sentimentController.getSentiment);
router.get('/snapshot/:symbol', authGuard(), sentimentController.getSentimentSnapshot);
export default router;
