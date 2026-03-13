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
    onAccountInformationUpdated(_instanceIndex: string, accountInformation: unknown) {
      const pub = getPublisher();
      if (!pub) return;
      const payload: AccountUpdatePayload = {
        type: 'account_info',
        accountId: metaapiAccountId,
        data: (accountInformation as Record<string, unknown>) ?? {},
      };
      publishAccountUpdate(pub, payload);
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
    onDealSynchronizationFinished(_instanceIndex: string, _synchronizationId: string) {
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

  await connection.connect();
  await connection.waitSynchronized();

  const listener = buildListener(metaapiAccountId);
  connection.addSynchronizationListener(listener);

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
