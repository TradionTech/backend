import { Router } from 'express';
import { authGuard } from '../middleware/auth.js';
import { profileController } from '../controllers/profile.controller.js';

const router = Router();

router.post('/recompute/:userId', authGuard(), profileController.recomputeProfileHandler);
router.get('/:userId', authGuard(), profileController.getProfileHandler);

export default router;
