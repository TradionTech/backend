/**
 * Run streaming logic in the same process as the API (e.g. for Render free plan without Background Workers).
 * Subscribes to Redis streaming:subscribe / streaming:unsubscribe and manages MetaAPI connections.
 * Does not call initSequelize (app already does) or process.exit.
 */

import type Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  createRedisPublisher,
  createRedisSubscriber,
  subscribeToStreamingCommands,
} from './accountUpdateBus';
import { subscribe, unsubscribe, setPublisher } from './streamingConnectionManager';

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

/**
 * Start the streaming connection manager in-process: subscribe to Redis commands and open/close MetaAPI connections.
 * Call once after the HTTP server and account WebSocket are attached. No-op if REDIS_URL or streaming is disabled.
 */
export function attachStreamingInProcess(): void {
  if (!env.STREAMING_IN_PROCESS) {
    logger.debug('Streaming in-process skipped: STREAMING_IN_PROCESS is false');
    return;
  }
  if (!env.STREAMING_SERVICE_ENABLED) {
    logger.debug('Streaming in-process skipped: STREAMING_SERVICE_ENABLED is false');
    return;
  }
  if (!env.REDIS_URL?.trim()) {
    logger.debug('Streaming in-process skipped: REDIS_URL not set');
    return;
  }
  if (!env.METAAPI_TOKEN?.trim()) {
    logger.debug('Streaming in-process skipped: METAAPI_TOKEN not set');
    return;
  }

  publisher = createRedisPublisher();
  subscriber = createRedisSubscriber();
  if (!publisher || !subscriber) {
    logger.warn('Streaming in-process: failed to create Redis clients');
    return;
  }

  setPublisher(publisher);
  subscribeToStreamingCommands(
    subscriber,
    (msg) => {
      subscribe(msg.metaapiAccountId).catch((e) =>
        logger.warn('Streaming subscribe failed', {
          metaapiAccountId: msg.metaapiAccountId,
          err: e instanceof Error ? e.message : String(e),
        })
      );
    },
    (msg) => {
      unsubscribe(msg.metaapiAccountId);
    }
  );

  logger.info('Streaming (in-process) running', {
    maxConnections: env.METAAPI_STREAMING_MAX_CONNECTIONS,
    gracePeriodMs: env.METAAPI_STREAMING_GRACE_PERIOD_MS,
  });
}

/**
 * Disconnect Redis clients used by in-process streaming. Call during graceful shutdown if desired.
 */
export function disconnectStreamingInProcess(): void {
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
  }
  if (publisher) {
    publisher.disconnect();
    publisher = null;
  }
  setPublisher(null);
  logger.debug('Streaming in-process disconnected');
}
