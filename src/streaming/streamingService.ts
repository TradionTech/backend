/**
 * Central streaming service entrypoint. Run as a separate process.
 * Subscribes to Redis streaming:subscribe / streaming:unsubscribe and manages MetaAPI streaming connections.
 */

import 'dotenv/config';
import { initSequelize } from '../db/sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { createRedisPublisher, createRedisSubscriber, subscribeToStreamingCommands } from './accountUpdateBus';
import { subscribe, unsubscribe, setPublisher } from './streamingConnectionManager';

async function main() {
  if (!env.STREAMING_SERVICE_ENABLED) {
    logger.info('Streaming service disabled by config');
    process.exit(0);
  }
  if (!env.REDIS_URL?.trim()) {
    logger.warn('Streaming service: REDIS_URL not set');
    process.exit(1);
  }
  if (!env.METAAPI_TOKEN?.trim()) {
    logger.warn('Streaming service: METAAPI_TOKEN not set');
    process.exit(1);
  }

  await initSequelize();

  const publisher = createRedisPublisher();
  const subscriber = createRedisSubscriber();
  if (!publisher || !subscriber) {
    logger.error('Streaming service: failed to create Redis clients');
    process.exit(1);
  }
  setPublisher(publisher);

  subscribeToStreamingCommands(
    subscriber,
    (msg) => {
      subscribe(msg.metaapiAccountId).catch((e) =>
        logger.warn('Streaming subscribe failed', { metaapiAccountId: msg.metaapiAccountId, err: (e as Error)?.message })
      );
    },
    (msg) => {
      unsubscribe(msg.metaapiAccountId);
    }
  );

  logger.info('Streaming service running', {
    maxConnections: env.METAAPI_STREAMING_MAX_CONNECTIONS,
    gracePeriodMs: env.METAAPI_STREAMING_GRACE_PERIOD_MS,
  });

  const shutdown = () => {
    logger.info('Streaming service shutting down');
    subscriber.disconnect();
    publisher.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  logger.error('Streaming service failed to start', { err: (e as Error)?.message });
  process.exit(1);
});
