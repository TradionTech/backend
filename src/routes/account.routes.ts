import { Router } from 'express';
import { authGuard } from '../middleware/auth';
import { accountController } from '../controllers/account.controller';

const router = Router();

router.post('/', authGuard(), accountController.link);
router.post('/provision', authGuard(), accountController.provision);
router.get('/', authGuard(), accountController.list);
router.get('/servers', authGuard(), accountController.servers);
router.delete('/:id', authGuard(), accountController.unlink);

router.post('/:id/sync-state', authGuard(), accountController.syncState);
router.get('/:id/summary', authGuard(), accountController.summary);
router.get('/:id/balance', authGuard(), accountController.balance);
router.get('/:id/positions', authGuard(), accountController.positions);
router.get('/:id/history', authGuard(), accountController.history);

export default router;
