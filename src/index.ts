import { createServer } from './server';
import { env } from './config/env';
import { logger } from './config/logger';
import { attachPriceWebSocket } from './ws/priceWebSocket';
import { attachAccountWebSocket } from './ws/accountWebSocket';
import { attachStreamingInProcess } from './streaming/attachStreamingInProcess';

const app = createServer();
const port = Number(env.PORT || 8080);

const httpServer = app.listen(port, () => {
  logger.info(`TradionAI API running on :${port} [${env.NODE_ENV}]`);
});

attachPriceWebSocket(httpServer);
attachAccountWebSocket(httpServer);
attachStreamingInProcess();

if (env.ENABLE_JOBS) {
  void import('./jobs/scheduler').catch((err) => {
    logger.error('Failed to start jobs scheduler', { err: (err as Error)?.message });
  });
}
