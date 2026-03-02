import { Router } from 'express';
import { authGuard } from '../middleware/auth';
import { authController } from '../controllers/auth.controller';

const router = Router();

// Helper endpoint to verify authentication (for testing)
// Returns current user info if token is valid
router.get('/info', authGuard(), authController.getAuthInfo);

export default router;
