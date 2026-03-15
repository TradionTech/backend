/**
 * Backend WebSocket server for live price data.
 * Server subscribes to a fixed set of priority symbols (Finnhub free tier: 50).
 * All trade messages are broadcast to every connected client; dashboard filters locally.
 * Enriched snapshots (pct change vs day open, SMA5, SMA20) are sent on a timer.
 * Uses noServer: true so a single upgrade handler can route both price and account WS.
 * @see https://finnhub.io/docs/api/websocket-trades
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { FinnhubWebSocketService } from '../services/finnhub/finnhubWebSocketService';
import type { FinnhubWSMessage, FinnhubTradeItem } from '../services/finnhub/finnhubWebSocketTypes';
import {
  getPrioritySymbols,
  FINNHUB_WS_SYMBOL_LIMIT,
} from '../services/finnhub/prioritySymbols';
import { PriceSnapshotState } from '../services/finnhub/priceSnapshotState';
import type { PriceSnapshotMessage } from '../services/finnhub/priceSnapshotTypes';

export const PRICE_WS_PATH = '/api/ws';

export interface PriceWebSocketRoute {
  wss: WebSocketServer;
  path: string;
}

/** Creates the price WebSocket server with noServer: true. Caller must handle upgrade and route by path. */
export function attachPriceWebSocket(): PriceWebSocketRoute | null {
  if (!env.FINNHUB_API_KEY) {
    logger.warn('Price WebSocket disabled: FINNHUB_API_KEY not set');
    return null;
  }

  const symbolLimit = Math.max(1, Math.min(env.FINNHUB_WS_SYMBOL_LIMIT, 50));
  const symbolOverride = env.FINNHUB_WS_SYMBOLS
    ? env.FINNHUB_WS_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const symbols = getPrioritySymbols(symbolOverride, symbolLimit);

  const snapshotState = new PriceSnapshotState(symbols);
  const snapshotIntervalMs = Math.max(1000, Math.min(env.FINNHUB_WS_SNAPSHOT_INTERVAL_MS ?? 2000, 60_000));

  const wss = new WebSocketServer({ noServer: true });

  const finnhub = new FinnhubWebSocketService({
    apiKey: env.FINNHUB_API_KEY,
    onTrade(message: FinnhubWSMessage) {
      if (message.type !== 'trade' || !message.data?.length) return;
      for (const item of message.data as FinnhubTradeItem[]) {
        if (item.s && typeof item.p === 'number') {
          snapshotState.updateFromTrade(item.s, item.p, item.t);
        }
      }
      const payload = JSON.stringify(message);
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          (client as WebSocket).send(payload);
        }
      });
    },
    onConnected() {
      symbols.forEach((s) => finnhub.subscribe(s));
      logger.info('Finnhub price WebSocket subscribed to symbols', {
        count: symbols.length,
        limit: FINNHUB_WS_SYMBOL_LIMIT,
      });
    },
  });

  finnhub.connect();

  wss.on('connection', (ws: WebSocket) => {
    logger.debug('Price WebSocket client connected');
    // Send symbol list so dashboard knows what is streamed
    ws.send(
      JSON.stringify({
        type: 'symbols',
        symbols,
        limit: FINNHUB_WS_SYMBOL_LIMIT,
        snapshotIntervalMs,
      })
    );
  });

  // Enriched snapshot on a timer: pct change vs day open, SMA5, SMA20
  const snapshotTimer = setInterval(() => {
    snapshotState.tick();
    const data = snapshotState.getSnapshot(snapshotIntervalMs);
    if (data.length === 0) return;
    const msg: PriceSnapshotMessage = {
      type: 'snapshot',
      data,
      intervalMs: snapshotIntervalMs,
    };
    const payload = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        (client as WebSocket).send(payload);
      }
    });
  }, snapshotIntervalMs);

  logger.info(`Price WebSocket server listening on path ${PRICE_WS_PATH} (${symbols.length} symbols, snapshot every ${snapshotIntervalMs}ms)`);
  return { wss, path: PRICE_WS_PATH };
}
