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

const priceWs = attachPriceWebSocket();
const accountWs = attachAccountWebSocket();

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '', 'http://localhost').pathname;
  if (priceWs && pathname === priceWs.path) {
    priceWs.wss.handleUpgrade(request, socket, head, (ws) => {
      priceWs.wss.emit('connection', ws, request);
    });
  } else if (accountWs && pathname === accountWs.path) {
    accountWs.wss.handleUpgrade(request, socket, head, (ws) => {
      accountWs.wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

attachStreamingInProcess();

if (env.ENABLE_JOBS) {
  void import('./jobs/scheduler').catch((err) => {
    logger.error('Failed to start jobs scheduler', { err: (err as Error)?.message });
  });
}
