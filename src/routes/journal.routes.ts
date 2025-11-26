import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { journalController } from '../controllers/journal.controller.js';
import { requirePlan } from '../middleware/planGuard.js';

const router = Router();

const EntrySchema = Joi.object({
  symbol: Joi.string().required(),
  direction: Joi.string().valid('LONG', 'SHORT').required(),
  entry_price: Joi.number().positive().required(),
  exit_price: Joi.number().positive().allow(null),
  notes: Joi.string().allow('', null)
});

const AnalyzeSchema = Joi.object({
  symbol: Joi.string().required(),
  direction: Joi.string().valid('LONG', 'SHORT').required(),
  entry_price: Joi.number().positive().required(),
  exit_price: Joi.number().positive().allow(null),
  notes: Joi.string().allow('', null)
});

router.post('/entries', authGuard(), validateBody(EntrySchema), journalController.createEntry);
router.post('/analyze', authGuard(), validateBody(AnalyzeSchema), journalController.analyze); // gated by usage inside

// Example: if you want Pro-only analysis, add requirePlan('pro')
// router.post('/analyze', authGuard(), requirePlan('pro'), validateBody(AnalyzeSchema), journalController.analyze);

export default router;

