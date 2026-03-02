import { Router } from 'express';
import Joi from 'joi';
import { authGuard } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { journalController } from '../controllers/journal.controller';
import { requirePlan } from '../middleware/planGuard';

const router = Router();

const EntrySchema = Joi.object({
  symbol: Joi.string().required(),
  direction: Joi.string().valid('LONG', 'SHORT').required(),
  entry_price: Joi.number().positive().required(),
  exit_price: Joi.number().positive().allow(null),
  notes: Joi.string().allow('', null),
});

const AnalyzeSchema = Joi.object({
  symbol: Joi.string().required(),
  direction: Joi.string().valid('LONG', 'SHORT').required(),
  entry_price: Joi.number().positive().required(),
  exit_price: Joi.number().positive().allow(null),
  notes: Joi.string().allow('', null),
});

const CoachingSchema = Joi.object({
  message: Joi.string().required().min(1),
  coachingIntent: Joi.string()
    .valid(
      'overview',
      'recent_performance',
      'pattern_detection',
      'risk_discipline',
      'emotional_control'
    )
    .optional(),
});

router.post('/entries', authGuard(), validateBody(EntrySchema), journalController.createEntry);
router.post('/analyze', authGuard(), validateBody(AnalyzeSchema), journalController.analyze); // gated by usage inside

// Journal analysis endpoints
router.get('/analysis/:userId', authGuard(), journalController.getAnalysis);
router.post('/coaching', authGuard(), validateBody(CoachingSchema), journalController.coaching); // gated by usage inside

// Example: if you want Pro-only analysis, add requirePlan('pro')
// router.post('/analyze', authGuard(), requirePlan('pro'), validateBody(AnalyzeSchema), journalController.analyze);

export default router;
