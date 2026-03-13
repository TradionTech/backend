/**
 * Finnhub WebSocket service: single connection to wss://ws.finnhub.io,
 * aggregates symbol subscriptions and forwards trade messages to a callback.
 * Used by the backend WebSocket server to feed live price data to frontend clients.
 * @see https://finnhub.io/docs/api/websocket-trades
 */

import WebSocket from 'ws';
import { logger } from '../../config/logger';
import type { FinnhubWSMessage } from './finnhubWebSocketTypes';

const FINNHUB_WS_URL = 'wss://ws.finnhub.io';

export type TradeMessageHandler = (message: FinnhubWSMessage) => void;

export interface FinnhubWebSocketServiceConfig {
  apiKey: string;
  onTrade?: TradeMessageHandler;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class FinnhubWebSocketService {
  private ws: WebSocket | null = null;
  private readonly apiKey: string;
  private readonly onTrade: TradeMessageHandler | undefined;
  private readonly onConnected: (() => void) | undefined;
  private readonly onDisconnected: (() => void) | undefined;
  private readonly subscribedSymbols = new Set<string>();
  /** Ref count per symbol so we only unsubscribe from Finnhub when no client needs it */
  private readonly symbolRefCount = new Map<string, number>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectDelayMs = 30_000;

  constructor(config: FinnhubWebSocketServiceConfig) {
    this.apiKey = config.apiKey;
    this.onTrade = config.onTrade;
    this.onConnected = config.onConnected;
    this.onDisconnected = config.onDisconnected;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    const url = `${FINNHUB_WS_URL}?token=${this.apiKey}`;
    try {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
      this.ws.on('error', (err) => this.handleError(err));
      this.ws.on('close', () => this.handleClose());
    } catch (err) {
      logger.error('Finnhub WebSocket connect failed', { error: err });
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.subscribedSymbols.clear();
    this.symbolRefCount.clear();
  }

  subscribe(symbol: string): void {
    const upper = symbol.toUpperCase();
    const count = (this.symbolRefCount.get(upper) ?? 0) + 1;
    this.symbolRefCount.set(upper, count);
    if (count === 1) {
      this.subscribedSymbols.add(upper);
      this.send({ type: 'subscribe', symbol: upper });
      logger.debug('Finnhub subscribe', { symbol: upper });
    }
  }

  unsubscribe(symbol: string): void {
    const upper = symbol.toUpperCase();
    const count = this.symbolRefCount.get(upper) ?? 0;
    if (count <= 0) return;
    const next = count - 1;
    this.symbolRefCount.set(upper, next);
    if (next === 0) {
      this.symbolRefCount.delete(upper);
      this.subscribedSymbols.delete(upper);
      this.send({ type: 'unsubscribe', symbol: upper });
      logger.debug('Finnhub unsubscribe', { symbol: upper });
    }
  }

  getSubscribedSymbols(): Set<string> {
    return new Set(this.subscribedSymbols);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(payload: { type: string; symbol: string }): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      logger.warn('Finnhub WebSocket send failed', { error: err, payload });
    }
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    logger.info('Finnhub WebSocket connected');
    // Re-subscribe all symbols after reconnect
    for (const symbol of this.subscribedSymbols) {
      this.send({ type: 'subscribe', symbol });
    }
    this.onConnected?.();
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const raw = data.toString();
      if (raw === 'ping' || raw === '') return;
      const msg = JSON.parse(raw) as FinnhubWSMessage;
      if (msg.type === 'trade' && msg.data && this.onTrade) {
        this.onTrade(msg);
      }
    } catch (err) {
      logger.warn('Finnhub WebSocket message parse error', { error: err, raw: String(data) });
    }
  }

  private handleError(err: Error): void {
    logger.warn('Finnhub WebSocket error', { error: err.message });
  }

  private handleClose(): void {
    this.ws = null;
    this.onDisconnected?.();
    logger.info('Finnhub WebSocket disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.maxReconnectDelayMs);
    this.reconnectAttempts += 1;
    logger.info('Finnhub WebSocket reconnecting', { attempt: this.reconnectAttempts, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
