/**
 * Enriched snapshot message sent periodically to WebSocket clients.
 * One object per symbol with last price, % change for the day, and optional moving averages.
 */

export interface PriceSnapshotItem {
  /** Symbol (e.g. AAPL, BINANCE:BTCUSDT, OANDA:EUR_USD) */
  s: string;
  /** Last trade price */
  p: number;
  /** Price used as "open" for the day (UTC day); first price seen that day or previous close proxy */
  o: number;
  /** Percent change vs day open: ((p - o) / o) * 100 */
  pct: number;
  /** Simple moving average over last 5 snapshot ticks (~5 seconds) */
  sma5?: number;
  /** Simple moving average over last 20 snapshot ticks (~20 seconds) */
  sma20?: number;
  /** Unix timestamp (ms) of the snapshot */
  ts: number;
}

export interface PriceSnapshotMessage {
  type: 'snapshot';
  data: PriceSnapshotItem[];
  /** Interval in ms between snapshots (e.g. 2000) */
  intervalMs: number;
}
