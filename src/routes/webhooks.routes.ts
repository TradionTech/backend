import { Router } from 'express';
import express from 'express';
import { clerkWebhookHandler } from '../controllers/webhooks.controller.js';

const router = Router();

// Use raw body for Svix signature verification
const rawJson = express.raw({ type: 'application/json' });
router.post('/clerk', rawJson, clerkWebhookHandler);

export default router;
