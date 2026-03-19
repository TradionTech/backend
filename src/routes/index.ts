import { Router } from 'express';
import chatRoutes from './chat.routes';
import riskRoutes from './risk.routes';
import journalRoutes from './journal.routes';
import sentimentRoutes from './sentiment.routes';
import billingRoutes from './billing.routes';
import adminRoutes from './admin.routes';
import accountRoutes from './account.routes';
import usersRoutes from './users.routes';
import profileRoutes from './profile.routes';
import chartRoutes from './chart.routes';
import authRoutes from './auth.routes';
import signalRoutes from './signal.routes';

const router = Router();

router.use('/chat', chatRoutes);
router.use('/risk', riskRoutes);
router.use('/journal', journalRoutes);
router.use('/sentiment', sentimentRoutes);
router.use('/billing', billingRoutes);
router.use('/admin', adminRoutes);
router.use('/accounts', accountRoutes);
router.use('/users', usersRoutes);
router.use('/profiles', profileRoutes);
router.use('/charts', chartRoutes);
router.use('/auth', authRoutes);
router.use('/confirm-signal', signalRoutes);

export default router;
