/**
 * Account WebSocket server: /api/ws/account
 * Auth via Clerk token (query ?token= or Authorization header). Subscribe/unsubscribe to account updates from Redis.
 * Uses noServer: true so a single upgrade handler can route both price and account WS.
 */

import type { IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from '@clerk/backend';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { MetaApiAccount } from '../db/models/MetaApiAccount';
import {
  createRedisPublisher,
  createRedisSubscriber,
  subscribeToAccountUpdates,
  publishStreamingSubscribe,
  publishStreamingUnsubscribe,
  getAccountUpdatesChannel,
  type AccountUpdatePayload,
} from '../streaming/accountUpdateBus';

export const ACCOUNT_WS_PATH = '/api/ws/account';

export interface AccountWebSocketRoute {
  wss: WebSocketServer;
  path: string;
}

interface ClientState {
  userId: string;
  allowedAccountIds: Set<string>;
  subscribedAccountIds: Set<string>;
  unsubFns: Map<string, () => void>;
}

const channelToClients = new Map<string, Set<WebSocket>>();
const channelUnsubFns = new Map<string, () => void>();

function getTokenFromRequest(url: string, headers: Record<string, string | string[] | undefined>): string | null {
  try {
    const u = new URL(url, 'http://localhost');
    const q = u.searchParams.get('token');
    if (q) return q;
    const auth = headers['authorization'];
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
    return null;
  } catch {
    return null;
  }
}

async function authenticateWs(url: string, headers: Record<string, string | string[] | undefined>): Promise<{ userId: string } | null> {
  const token = getTokenFromRequest(url, headers);
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    const userId = payload?.sub ?? null;
    if (!userId) return null;
    return { userId };
  } catch (e) {
    logger.debug('Account WS auth failed', { err: (e as Error)?.message });
    return null;
  }
}

/** Creates the account WebSocket server with noServer: true. Caller must handle upgrade and route by path. */
export function attachAccountWebSocket(): AccountWebSocketRoute | null {
  if (!env.ACCOUNT_WS_ENABLED) {
    logger.info('Account WebSocket disabled by config');
    return null;
  }
  if (!env.REDIS_URL?.trim()) {
    logger.warn('Account WebSocket disabled: REDIS_URL not set');
    return null;
  }

  const publisher = createRedisPublisher();
  const subscriber = createRedisSubscriber();
  if (!publisher || !subscriber) {
    logger.warn('Account WebSocket disabled: Redis clients not available');
    return null;
  }

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url ?? '';
    const headers: Record<string, string | string[] | undefined> = {};
    req.headers && Object.assign(headers, req.headers);
    const auth = await authenticateWs(url, headers);
    if (!auth) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    let rows: MetaApiAccount[];
    try {
      rows = await MetaApiAccount.findAll({ where: { userId: auth.userId }, attributes: ['metaapiAccountId'] });
    } catch (e) {
      logger.warn('Account WS: failed to load user accounts', { userId: auth.userId, err: (e as Error)?.message });
      ws.close(4500, 'Server error');
      return;
    }

    const allowedAccountIds = new Set(rows.map((r) => r.metaapiAccountId as string));
    const state: ClientState = {
      userId: auth.userId,
      allowedAccountIds,
      subscribedAccountIds: new Set(),
      unsubFns: new Map(),
    };
    (ws as WebSocket & { _state?: ClientState })._state = state;

    ws.send(JSON.stringify({ type: 'ready', message: 'Connected. Send subscribe with accountIds.' }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === 'subscribe' && Array.isArray(msg.accountIds)) {
          for (const id of msg.accountIds) {
            const metaapiAccountId = String(id).trim();
            if (!state.allowedAccountIds.has(metaapiAccountId)) continue;
            if (state.subscribedAccountIds.has(metaapiAccountId)) continue;
            state.subscribedAccountIds.add(metaapiAccountId);
            publishStreamingSubscribe(publisher, { metaapiAccountId, userId: state.userId });
            const channel = getAccountUpdatesChannel(metaapiAccountId);
            let clients = channelToClients.get(channel);
            if (!clients) {
              clients = new Set();
              channelToClients.set(channel, clients);
              const unsubRedis = subscribeToAccountUpdates(subscriber, metaapiAccountId, (payload: AccountUpdatePayload) => {
                const data = JSON.stringify(payload);
                const set = channelToClients.get(channel);
                set?.forEach((c) => {
                  if (c.readyState === 1) c.send(data);
                });
              });
              channelUnsubFns.set(channel, unsubRedis);
            }
            clients.add(ws);
            const unsub = () => {
              clients?.delete(ws);
              if (clients?.size === 0) {
                channelToClients.delete(channel);
                const fn = channelUnsubFns.get(channel);
                if (fn) {
                  fn();
                  channelUnsubFns.delete(channel);
                }
              }
              publishStreamingUnsubscribe(publisher, { metaapiAccountId, userId: state.userId });
              state.subscribedAccountIds.delete(metaapiAccountId);
              state.unsubFns.delete(metaapiAccountId);
            };
            state.unsubFns.set(metaapiAccountId, unsub);
          }
        } else if (msg.action === 'unsubscribe' && Array.isArray(msg.accountIds)) {
          for (const id of msg.accountIds) {
            const metaapiAccountId = String(id).trim();
            const unsub = state.unsubFns.get(metaapiAccountId);
            if (unsub) unsub();
          }
        }
      } catch (e) {
        logger.debug('Account WS invalid message', { err: (e as Error)?.message });
      }
    });

    ws.on('close', () => {
      state.unsubFns.forEach((fn) => fn());
      state.unsubFns.clear();
    });
  });

  logger.info(`Account WebSocket server listening on path ${ACCOUNT_WS_PATH}`);
  return { wss, path: ACCOUNT_WS_PATH };
}
