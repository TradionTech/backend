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
import {
  applyDeal,
  setAccountPositionCount,
  buildSummaryResponse,
  buildPerformanceResponse,
  isPrimed,
  primeJournalAggregatesFromDb,
  primeJournalAggregatesFromRest,
} from '../streaming/journalAggregates';
import {
  deleteAccountViaProvisioningApi,
  updateAccountViaProvisioningApi,
  type UpdateMetaApiAccountBody,
} from '../services/brokers/metaapi';

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
  wantsJournalUpdates: boolean;
}

const channelToClients = new Map<string, Set<WebSocket>>();
const channelUnsubFns = new Map<string, () => void>();
/** metaapiAccountId -> userId for resolving account updates to journal pushes */
const accountIdToUserId = new Map<string, string>();
/** userId -> Set of WebSockets for pushing journal updates */
const userIdToClients = new Map<string, Set<WebSocket>>();

const JOURNAL_PUSH_DEBOUNCE_MS = 2000;
const journalPushTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function resolveUserIdForAccount(accountId: string): Promise<string | null> {
  const cached = accountIdToUserId.get(accountId);
  if (cached) return cached;
  const row = await MetaApiAccount.findOne({
    where: { metaapiAccountId: accountId },
    attributes: ['userId'],
  });
  const userId = row?.userId as string | undefined;
  if (userId) accountIdToUserId.set(accountId, userId);
  return userId ?? null;
}

function scheduleJournalPush(userId: string): void {
  const existing = journalPushTimers.get(userId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    journalPushTimers.delete(userId);
    void runJournalPush(userId);
  }, JOURNAL_PUSH_DEBOUNCE_MS);
  journalPushTimers.set(userId, timer);
}

async function runJournalPush(userId: string): Promise<void> {
  const clients = userIdToClients.get(userId);
  if (!clients?.size) return;

  const wantJournal = Array.from(clients).some(
    (c) => (c as WebSocket & { _state?: ClientState })._state?.wantsJournalUpdates
  );
  if (!wantJournal) return;

  if (!isPrimed(userId)) {
    const fromRest = await primeJournalAggregatesFromRest(userId);
    if (!fromRest) {
      await primeJournalAggregatesFromDb(userId);
    }
  }

  const summary = buildSummaryResponse(userId);
  const performance = buildPerformanceResponse(userId);
  const summaryMsg = JSON.stringify({ type: 'journal_summary', data: summary });
  const perfMsg = JSON.stringify({ type: 'journal_performance', data: performance });

  for (const ws of clients) {
    if (ws.readyState !== 1) continue;
    const state = (ws as WebSocket & { _state?: ClientState })._state;
    if (!state?.wantsJournalUpdates) continue;
    ws.send(summaryMsg);
    ws.send(perfMsg);
  }
}

function onAccountUpdate(payload: AccountUpdatePayload, channel: string): void {
  const accountId = payload.accountId;
  const type = payload.type;

  if (type === 'deals' && Array.isArray(payload.data)) {
    resolveUserIdForAccount(accountId).then((userId) => {
      if (!userId) return;
      for (const deal of payload.data as Record<string, unknown>[]) {
        applyDeal(userId, deal, accountId);
      }
      scheduleJournalPush(userId);
    });
  } else if (type === 'positions') {
    const count = Array.isArray(payload.data) ? payload.data.length : 0;
    resolveUserIdForAccount(accountId).then((userId) => {
      if (!userId) return;
      setAccountPositionCount(userId, accountId, count);
      scheduleJournalPush(userId);
    });
  } else if (type === 'synchronized') {
    resolveUserIdForAccount(accountId).then((userId) => {
      if (!userId) return;
      scheduleJournalPush(userId);
    });
  }
}

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
      wantsJournalUpdates: false,
    };
    (ws as WebSocket & { _state?: ClientState })._state = state;

    let clientsForUser = userIdToClients.get(state.userId);
    if (!clientsForUser) {
      clientsForUser = new Set();
      userIdToClients.set(state.userId, clientsForUser);
    }
    clientsForUser.add(ws);

    ws.send(JSON.stringify({ type: 'ready', message: 'Connected. Send subscribe with accountIds.' }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === 'subscribe' && Array.isArray(msg.accountIds)) {
          for (const id of msg.accountIds) {
            const metaapiAccountId = String(id).trim();
            if (!state.allowedAccountIds.has(metaapiAccountId)) continue;
            if (state.subscribedAccountIds.has(metaapiAccountId)) continue;
            state.subscribedAccountIds.add(metaapiAccountId);
            accountIdToUserId.set(metaapiAccountId, state.userId);
            publishStreamingSubscribe(publisher, { metaapiAccountId, userId: state.userId });
            const channel = getAccountUpdatesChannel(metaapiAccountId);
            let clients = channelToClients.get(channel);
            if (!clients) {
              clients = new Set();
              channelToClients.set(channel, clients);
              const unsubRedis = subscribeToAccountUpdates(subscriber, metaapiAccountId, (payload: AccountUpdatePayload) => {
                onAccountUpdate(payload, channel);
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
        } else if (msg.action === 'account_credentials_update') {
          const metaapiAccountId = String(msg.accountId ?? '').trim();
          if (!metaapiAccountId || !state.allowedAccountIds.has(metaapiAccountId)) {
            return;
          }

          const payload: UpdateMetaApiAccountBody = {};
          if (typeof msg.password === 'string' && msg.password.trim()) {
            payload.password = msg.password.trim();
          }
          if (typeof msg.name === 'string' && msg.name.trim()) {
            payload.name = msg.name.trim();
          }
          if (typeof msg.server === 'string' && msg.server.trim()) {
            payload.server = msg.server.trim();
          }

          if (!payload.password) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'account_credentials_update requires password',
              })
            );
            return;
          }

          try {
            await updateAccountViaProvisioningApi(metaapiAccountId, payload);
            await MetaApiAccount.update(
              {
                ...(payload.name && { name: payload.name }),
                ...(payload.server && { server: payload.server }),
              },
              { where: { metaapiAccountId, userId: state.userId } }
            );
            ws.send(
              JSON.stringify({
                type: 'account_credentials_update_ok',
                accountId: metaapiAccountId,
              })
            );
          } catch (e) {
            ws.send(
              JSON.stringify({
                type: 'account_credentials_update_error',
                accountId: metaapiAccountId,
                message: (e as Error)?.message ?? 'Failed to update account credentials',
              })
            );
          }
        } else if (msg.action === 'subscribe_journal') {
          state.wantsJournalUpdates = true;
          void runJournalPush(state.userId);
        } else if (msg.action === 'unsubscribe_journal') {
          state.wantsJournalUpdates = false;
        } else if (msg.action === 'account_delete_confirm') {
          const metaapiAccountId = String(msg.accountId ?? '').trim();
          if (!metaapiAccountId || !state.allowedAccountIds.has(metaapiAccountId)) {
            return;
          }

          try {
            await deleteAccountViaProvisioningApi(metaapiAccountId);
          } catch {
            // Even if remote delete fails, attempt to remove local record to avoid dangling references
          }

          await MetaApiAccount.destroy({
            where: { metaapiAccountId, userId: state.userId },
          });

          ws.send(
            JSON.stringify({
              type: 'account_deleted',
              accountId: metaapiAccountId,
            })
          );
        }
      } catch (e) {
        logger.debug('Account WS invalid message', { err: (e as Error)?.message });
      }
    });

    ws.on('close', () => {
      state.unsubFns.forEach((fn) => fn());
      state.unsubFns.clear();
      const set = userIdToClients.get(state.userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) userIdToClients.delete(state.userId);
      }
    });
  });

  logger.info(`Account WebSocket server listening on path ${ACCOUNT_WS_PATH}`);
  return { wss, path: ACCOUNT_WS_PATH };
}
