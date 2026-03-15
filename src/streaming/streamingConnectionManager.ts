/**
 * Manages MetaAPI streaming connections per account: lazy open, grace-period close, cap.
 * Listens to sync events and publishes payloads to Redis via accountUpdateBus.
 */

import type { StreamingConnection, SynchronizationListener, TerminalState } from 'metaapi.cloud-sdk';
import MetaApi from 'metaapi.cloud-sdk/esm-node';
import type Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  createRedisPublisher,
  publishAccountUpdate,
  type AccountUpdatePayload,
} from './accountUpdateBus';
import { createSequelizeHistoryStorage } from '../services/brokers/sequelizeHistoryStorage';

const metaApi = new MetaApi(env.METAAPI_TOKEN || '');

interface ConnectionState {
  connection: StreamingConnection;
  listener: SynchronizationListener;
  subscriberCount: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  metaapiAccountId: string;
}

const connections = new Map<string, ConnectionState>();
let publisher: Redis | null = null;

function getPublisher(): Redis | null {
  if (!publisher) publisher = createRedisPublisher();
  return publisher;
}

function buildListener(metaapiAccountId: string): SynchronizationListener {
  return {
    onConnected() {},
    onSynchronizationStarted() {},
    onBrokerConnectionStatusChanged() {},
    onHealthStatus() {},
    onSymbolSpecificationUpdated() {},
    onSymbolSpecificationsUpdated() {},
    onAccountInformationUpdated(_instanceIndex: string, accountInformation: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, {
        type: 'account_info',
        accountId: metaapiAccountId,
        data: (accountInformation as Record<string, unknown>) ?? {},
      });
    },
    onPositionsReplaced(_instanceIndex: string, positions: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, {
        type: 'positions',
        accountId: metaapiAccountId,
        data: Array.isArray(positions) ? positions : [],
      });
    },
    onPositionsSynchronized(_instanceIndex: string, _synchronizationId?: string) {
      const pub = getPublisher();
      if (pub) publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
    },
    onPositionUpdated(_instanceIndex: string, position: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, {
        type: 'positions',
        accountId: metaapiAccountId,
        data: [position],
      });
    },
    onPositionRemoved(_instanceIndex: string, _positionId: string) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, { type: 'positions', accountId: metaapiAccountId, data: [] });
    },
    onPendingOrdersReplaced(_instanceIndex: string, orders: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, {
        type: 'orders',
        accountId: metaapiAccountId,
        data: Array.isArray(orders) ? orders : [],
      });
    },
    onPendingOrdersSynchronized(_instanceIndex: string, _synchronizationId?: string) {
      const pub = getPublisher();
      if (pub) publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
    },
    onOrderUpdated(_instanceIndex: string, order: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, { type: 'orders', accountId: metaapiAccountId, data: [order] });
    },
    onOrderCompleted(_instanceIndex: string, order: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, { type: 'orders', accountId: metaapiAccountId, data: [order] });
    },
    onOrderSynchronizationFinished(_instanceIndex: string, _synchronizationId: string) {
      const pub = getPublisher();
      if (pub) publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
    },
    onHistoryOrdersSynchronized() {
      const pub = getPublisher();
      if (pub) publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
    },
    onDealSynchronizationFinished(_instanceIndex: string, _synchronizationId: string) {
      const pub = getPublisher();
      if (pub) publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
    },
    onDealsSynchronized() {
      const pub = getPublisher();
      if (pub) publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
    },
    onDealAdded(_instanceIndex: string, deal: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      publishAccountUpdate(pub, { type: 'deals', accountId: metaapiAccountId, data: [deal] });
    },
  };
}

const STREAMING_CONNECT_MAX_RETRIES = 3;
const STREAMING_CONNECT_RETRY_DELAY_MS = 3000;

/**
 * MetaAPI can emit "Failed to subscribe TimeoutError" when the broker connection is briefly lost.
 * This is expected occasionally (MT terminal uptime is not perfect). We retry connect/sync to smooth over it.
 */
async function openConnection(metaapiAccountId: string): Promise<ConnectionState | null> {
  if (connections.size >= env.METAAPI_STREAMING_MAX_CONNECTIONS) {
    logger.warn('Streaming connection cap reached', {
      metaapiAccountId,
      cap: env.METAAPI_STREAMING_MAX_CONNECTIONS,
    });
    return null;
  }
  const account = await metaApi.metatraderAccountApi.getAccount(metaapiAccountId);
  if (!account) {
    logger.warn('MetaAPI account not found for streaming', { metaapiAccountId });
    return null;
  }
  if (account.state !== 'DEPLOYED') {
    await account.deploy();
  }
  await account.waitConnected();

  const historyStorage = await createSequelizeHistoryStorage(metaapiAccountId);
  const connection = historyStorage
    ? account.getStreamingConnection(historyStorage as any)
    : account.getStreamingConnection();

  const listener = buildListener(metaapiAccountId);
  connection.addSynchronizationListener(listener);

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= STREAMING_CONNECT_MAX_RETRIES; attempt++) {
    try {
      await connection.connect();
      await connection.waitSynchronized();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const isTimeout =
        lastErr.name === 'TimeoutError' ||
        /not connected to broker|does not match the account region/i.test(lastErr.message);
      if (attempt < STREAMING_CONNECT_MAX_RETRIES && isTimeout) {
        logger.warn('Streaming connect/sync timeout, retrying', {
          metaapiAccountId,
          attempt,
          maxRetries: STREAMING_CONNECT_MAX_RETRIES,
          err: lastErr.message,
        });
        await new Promise((r) => setTimeout(r, STREAMING_CONNECT_RETRY_DELAY_MS));
      } else {
        throw lastErr;
      }
    }
  }
  if (lastErr) throw lastErr;

  const state: ConnectionState = {
    connection,
    listener,
    subscriberCount: 1,
    graceTimer: null,
    metaapiAccountId,
  };
  connections.set(metaapiAccountId, state);

  const pub = getPublisher();
  if (pub) {
    const terminalState: TerminalState = connection.terminalState;
    if (terminalState?.accountInformation) {
      publishAccountUpdate(pub, {
        type: 'account_info',
        accountId: metaapiAccountId,
        data: terminalState.accountInformation as Record<string, unknown>,
      });
    }
    if (Array.isArray(terminalState?.positions)) {
      publishAccountUpdate(pub, {
        type: 'positions',
        accountId: metaapiAccountId,
        data: terminalState.positions,
      });
    }
    publishAccountUpdate(pub, { type: 'synchronized', accountId: metaapiAccountId });
  }

  logger.info('Streaming connection opened', { metaapiAccountId });
  return state;
}

function scheduleClose(metaapiAccountId: string): void {
  const state = connections.get(metaapiAccountId);
  if (!state || state.subscriberCount > 0) return;
  if (state.graceTimer) clearTimeout(state.graceTimer);
  state.graceTimer = setTimeout(() => {
    state.graceTimer = null;
    state.connection.removeSynchronizationListener(state.listener);
    state.connection.close();
    connections.delete(metaapiAccountId);
    logger.info('Streaming connection closed', { metaapiAccountId });
  }, env.METAAPI_STREAMING_GRACE_PERIOD_MS);
}

export function subscribe(metaapiAccountId: string): Promise<boolean> {
  const existing = connections.get(metaapiAccountId);
  if (existing) {
    existing.subscriberCount++;
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
    }
    return Promise.resolve(true);
  }
  return openConnection(metaapiAccountId).then((state) => {
    if (state) {
      state.subscriberCount = 1;
      return true;
    }
    return false;
  });
}

export function unsubscribe(metaapiAccountId: string): void {
  const state = connections.get(metaapiAccountId);
  if (!state) return;
  state.subscriberCount = Math.max(0, state.subscriberCount - 1);
  if (state.subscriberCount === 0) scheduleClose(metaapiAccountId);
}

export function setPublisher(pub: Redis | null): void {
  publisher = pub;
}

export function getConnectionCount(): number {
  return connections.size;
}
