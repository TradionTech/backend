import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { clerkMiddleware } from '@clerk/express';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './config/rateLimit.js';
import routes from './routes/index.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger.js';
import { initSequelize } from './db/sequelize.js';

export function createServer() {
  const app = express();

  // Core middlewares
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  // Mount webhooks BEFORE json/body parsers so Svix verification gets raw body
  app.use('/api/webhooks', webhooksRoutes);
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('combined'));

  // Auth (Clerk attaches auth to req)
  app.use(clerkMiddleware());

  // Global rate limit
  app.use('/api', apiLimiter);

  // API docs
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  // DB init (sync in dev via script; here just ensure connection)
  initSequelize().catch((e) => {
    // Don't crash process; let readiness probe fail
    console.error('DB init error', e);
  });

  // Routes
  app.use('/api', routes);

  // Errors
  app.use(errorHandler);
  return app;
}
