/**
 * Types for Finnhub WebSocket API (live trades).
 * @see https://finnhub.io/docs/api/websocket-trades
 */

/** Single trade from Finnhub (data array item) */
export interface FinnhubTradeItem {
  s: string;   // symbol
  p: number;   // price
  v: number;   // volume
  t: number;   // timestamp (nanoseconds)
  c?: string[]; // conditions (optional)
}

/** Message received from Finnhub WebSocket */
export interface FinnhubWSMessage {
  type: 'trade' | 'ping' | string;
  data?: FinnhubTradeItem[];
}

/** Outbound subscribe (we send to Finnhub) */
export interface FinnhubSubscribeMessage {
  type: 'subscribe';
  symbol: string;
}

/** Outbound unsubscribe */
export interface FinnhubUnsubscribeMessage {
  type: 'unsubscribe';
  symbol: string;
}
