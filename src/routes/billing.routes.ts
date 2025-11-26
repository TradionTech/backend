import { Router } from 'express';
import { authGuard } from '../middleware/auth.js';
import { billingController } from '../controllers/billing.controller.js';

const router = Router();

router.post('/initiate', authGuard(), billingController.initiate);       // one-time or first sub payment
router.get('/verify', authGuard(), billingController.verify);            // verify by reference after redirect
router.post('/webhook/paystack', billingController.webhook);             // Paystack webhook

export default router;

