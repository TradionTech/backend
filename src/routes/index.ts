import { Router } from 'express';
import chatRoutes from './chat.routes.js';
import riskRoutes from './risk.routes.js';
import journalRoutes from './journal.routes.js';
import sentimentRoutes from './sentiment.routes.js';
import billingRoutes from './billing.routes.js';
import adminRoutes from './admin.routes.js';
import accountRoutes from './account.routes.js';
import usersRoutes from './users.routes.js';

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
