import { Router } from 'express';
import { authGuard } from '../middleware/auth';
import { adminController } from '../controllers/admin.controller';

const router = Router();
// In production add an isAdmin guard/role check
router.get('/health', adminController.health);
router.get('/metrics', authGuard(), adminController.metrics);

export default router;
