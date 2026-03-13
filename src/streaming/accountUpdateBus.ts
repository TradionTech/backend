/**
 * Redis bus for account streaming: publish account updates and subscribe/unsubscribe commands.
 * Channels: account:updates:{metaapiAccountId}, streaming:subscribe, streaming:unsubscribe.
 */

import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';

const CHANNEL_ACCOUNT_UPDATES_PREFIX = 'account:updates:';
const CHANNEL_STREAMING_SUBSCRIBE = 'streaming:subscribe';
const CHANNEL_STREAMING_UNSUBSCRIBE = 'streaming:unsubscribe';

export type AccountUpdatePayload =
  | { type: 'account_info'; accountId: string; data: Record<string, unknown> }
  | { type: 'positions'; accountId: string; data: unknown[] }
  | { type: 'orders'; accountId: string; data: unknown[] }
  | { type: 'deals'; accountId: string; data: unknown[] }
  | { type: 'synchronized'; accountId: string }
  | { type: 'error'; accountId: string; message: string }
  | { type: 'reconnect'; accountId: string };

export interface StreamingSubscribeMessage {
  metaapiAccountId: string;
  userId?: string;
}

export interface StreamingUnsubscribeMessage {
  metaapiAccountId: string;
  userId?: string;
}

export function getAccountUpdatesChannel(metaapiAccountId: string): string {
  return `${CHANNEL_ACCOUNT_UPDATES_PREFIX}${metaapiAccountId}`;
}

/** Create a Redis client for publishing. Use a separate client for subscribing. */
export function createRedisPublisher(): Redis | null {
  const url = env.REDIS_URL?.trim();
  if (!url) {
    logger.warn('Redis publisher not created: REDIS_URL not set');
    return null;
  }
  try {
    const client = new Redis(url, { maxRetriesPerRequest: 3 });
    client.on('error', (err) => logger.error('Redis publisher error', { err: err?.message }));
    return client;
  } catch (err: unknown) {
    logger.error('Failed to create Redis publisher', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Create a Redis client dedicated to subscribing (subscriber mode). */
export function createRedisSubscriber(): Redis | null {
  const url = env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    const client = new Redis(url, { maxRetriesPerRequest: 3 });
    client.on('error', (err) => logger.error('Redis subscriber error', { err: err?.message }));
    return client;
  } catch (err: unknown) {
    logger.error('Failed to create Redis subscriber', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Publish an account update to the bus. Call from streaming service. */
export function publishAccountUpdate(publisher: Redis, payload: AccountUpdatePayload): void {
  const channel = getAccountUpdatesChannel(payload.accountId);
  const message = JSON.stringify(payload);
  publisher.publish(channel, message).catch((err) => {
    logger.warn('Redis publish account update failed', { channel, err: err?.message });
  });
}

/** Publish subscribe command. Call from API server when a client subscribes to an account. */
export function publishStreamingSubscribe(
  publisher: Redis,
  message: StreamingSubscribeMessage
): void {
  publisher
    .publish(CHANNEL_STREAMING_SUBSCRIBE, JSON.stringify(message))
    .catch((err) =>
      logger.warn('Redis publish streaming:subscribe failed', { err: err?.message })
    );
}

/** Publish unsubscribe command. Call from API server when a client unsubscribes or disconnects. */
export function publishStreamingUnsubscribe(
  publisher: Redis,
  message: StreamingUnsubscribeMessage
): void {
  publisher
    .publish(CHANNEL_STREAMING_UNSUBSCRIBE, JSON.stringify(message))
    .catch((err) =>
      logger.warn('Redis publish streaming:unsubscribe failed', { err: err?.message })
    );
}

/** Subscribe to account updates for a given account. Call from API server. */
export function subscribeToAccountUpdates(
  subscriber: Redis,
  metaapiAccountId: string,
  onMessage: (payload: AccountUpdatePayload) => void
): () => void {
  const channel = getAccountUpdatesChannel(metaapiAccountId);
  const handler = (ch: string, message: string) => {
    if (ch !== channel) return;
    try {
      const payload = JSON.parse(message) as AccountUpdatePayload;
      onMessage(payload);
    } catch (e) {
      logger.warn('Invalid account update message', { channel, err: (e as Error)?.message });
    }
  };
  subscriber.subscribe(channel).then(() => subscriber.on('message', handler));
  return () => {
    subscriber.off('message', handler);
    subscriber.unsubscribe(channel).catch(() => {});
  };
}

/** Subscribe to streaming:subscribe and streaming:unsubscribe. Call from central streaming service. */
export function subscribeToStreamingCommands(
  subscriber: Redis,
  onSubscribe: (msg: StreamingSubscribeMessage) => void,
  onUnsubscribe: (msg: StreamingUnsubscribeMessage) => void
): void {
  subscriber.subscribe(CHANNEL_STREAMING_SUBSCRIBE, CHANNEL_STREAMING_UNSUBSCRIBE).then(() => {
    subscriber.on('message', (channel, message) => {
      try {
        const parsed = JSON.parse(message);
        if (channel === CHANNEL_STREAMING_SUBSCRIBE) {
          onSubscribe(parsed as StreamingSubscribeMessage);
        } else if (channel === CHANNEL_STREAMING_UNSUBSCRIBE) {
          onUnsubscribe(parsed as StreamingUnsubscribeMessage);
        }
      } catch (e) {
        logger.warn('Invalid streaming command message', {
          channel,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    });
  });
}
