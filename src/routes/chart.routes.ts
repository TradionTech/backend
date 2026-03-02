import { Router } from 'express';
import { authGuard } from '../middleware/auth';
import { chartController } from '../controllers/chart.controller';

const router = Router();

router.post('/upload', authGuard(), chartController.uploadChart);

export default router;
