import { Router } from 'express';
import { ensureUser } from '../controllers/users.controller.js';

const router = Router();

router.post('/ensure', ensureUser);

export default router;
