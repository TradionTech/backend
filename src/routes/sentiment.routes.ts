import { Router } from 'express';
import { authGuard } from '../middleware/auth';
import { sentimentController } from '../controllers/sentiment.controller';

const router = Router();
router.get('/', authGuard(), sentimentController.getSentiment);
export default router;
