import { Router } from 'express';
import { ensureUser } from '../controllers/users.controller';

const router = Router();

router.post('/ensure', ensureUser);

export default router;
