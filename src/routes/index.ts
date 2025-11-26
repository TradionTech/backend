import { Router } from 'express';
import chatRoutes from './chat.routes';
import riskRoutes from './risk.routes';
import journalRoutes from './journal.routes';
import sentimentRoutes from './sentiment.routes';
import billingRoutes from './billing.routes';
import adminRoutes from './admin.routes';
import accountRoutes from './account.routes';
import usersRoutes from './users.routes';

const router = Router();

router.use('/chat', chatRoutes);
router.use('/risk', riskRoutes);
router.use('/journal', journalRoutes);
router.use('/sentiment', sentimentRoutes);
router.use('/billing', billingRoutes);
router.use('/admin', adminRoutes);
router.use('/accounts', accountRoutes);
router.use('/users', usersRoutes);

export default router;
