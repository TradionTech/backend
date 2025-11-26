import { createServer } from './server';
import { env } from './config/env';
import { logger } from './config/logger';

const app = createServer();
const port = Number(env.PORT || 8080);

app.listen(port, () => {
  logger.info(`TradionAI API running on :${port} [${env.NODE_ENV}]`);
});
