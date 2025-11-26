import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createServer();
const port = Number(env.PORT || 8080);

app.listen(port, () => {
  logger.info(`TradionAI API running on :${port} [${env.NODE_ENV}]`);
});

