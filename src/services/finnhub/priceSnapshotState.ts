/**
 * Maintains per-symbol state for enriched price snapshots: last price, day open,
 * and a rolling buffer of prices for SMA5 / SMA20. Updated from trades; snapshot
 * is built on a timer (e.g. every 2s).
 */

import type { PriceSnapshotItem } from './priceSnapshotTypes';

const SMA_WINDOW = 20;
const NS_PER_MS = 1e6;
const MS_PER_DAY = 86400 * 1000;

interface SymbolState {
  lastPrice: number;
  dayOpen: number;
  lastDayUtc: number;
  /** Circular buffer: one price per snapshot tick, max SMA_WINDOW */
  prices: number[];
  nextPriceIndex: number;
}

export class PriceSnapshotState {
  private readonly stateBySymbol = new Map<string, SymbolState>();
  private symbolList: string[];

  constructor(symbols: string[]) {
    this.symbolList = [...symbols];
    for (const s of symbols) {
      this.stateBySymbol.set(s, {
        lastPrice: 0,
        dayOpen: 0,
        lastDayUtc: 0,
        prices: [],
        nextPriceIndex: 0,
      });
    }
  }

  addSymbol(symbol: string): void {
    if (this.stateBySymbol.has(symbol)) return;
    this.symbolList.push(symbol);
    this.stateBySymbol.set(symbol, {
      lastPrice: 0,
      dayOpen: 0,
      lastDayUtc: 0,
      prices: [],
      nextPriceIndex: 0,
    });
  }

  removeSymbol(symbol: string): void {
    this.stateBySymbol.delete(symbol);
    this.symbolList = this.symbolList.filter((s) => s !== symbol);
  }

  /**
   * Call on each trade (or batch of trades) to update last price and day open.
   * Finnhub t is in nanoseconds.
   */
  updateFromTrade(symbol: string, price: number, timestampNs?: number): void {
    const st = this.stateBySymbol.get(symbol);
    if (!st) return;

    st.lastPrice = price;

    const utcMs = timestampNs != null ? timestampNs / NS_PER_MS : Date.now();
    const dayUtc = Math.floor(utcMs / MS_PER_DAY) * MS_PER_DAY;

    if (st.lastDayUtc === 0) {
      st.dayOpen = price;
      st.lastDayUtc = dayUtc;
    } else if (dayUtc > st.lastDayUtc) {
      st.dayOpen = price;
      st.lastDayUtc = dayUtc;
    }
  }

  /**
   * Call every snapshot interval (e.g. every 2s). Pushes current lastPrice into
   * the rolling buffer for each symbol so SMA can be computed.
   */
  tick(): void {
    for (const st of this.stateBySymbol.values()) {
      if (st.lastPrice <= 0) continue;
      if (st.prices.length < SMA_WINDOW) {
        st.prices.push(st.lastPrice);
      } else {
        st.prices[st.nextPriceIndex] = st.lastPrice;
        st.nextPriceIndex = (st.nextPriceIndex + 1) % SMA_WINDOW;
      }
    }
  }

  /**
   * Build the snapshot payload for all symbols. Call after tick().
   */
  getSnapshot(intervalMs: number): PriceSnapshotItem[] {
    const now = Date.now();
    const out: PriceSnapshotItem[] = [];

    for (const symbol of this.symbolList) {
      const st = this.stateBySymbol.get(symbol)!;
      if (st.lastPrice <= 0) continue;

      const dayOpen = st.dayOpen > 0 ? st.dayOpen : st.lastPrice;
      const pct =
        dayOpen > 0 ? ((st.lastPrice - dayOpen) / dayOpen) * 100 : 0;

      const sma5 = this.smaForSymbol(st, 5);
      const sma20 = this.smaForSymbol(st, 20);

      out.push({
        s: symbol,
        p: st.lastPrice,
        o: dayOpen,
        pct: Math.round(pct * 100) / 100,
        ts: now,
        ...(sma5 != null && { sma5: Math.round(sma5 * 100) / 100 }),
        ...(sma20 != null && { sma20: Math.round(sma20 * 100) / 100 }),
      });
    }

    return out;
  }

  /** Average of last n values; works for both fill phase and circular buffer. */
  private smaForSymbol(st: SymbolState, n: number): number | undefined {
    if (st.prices.length < n) return undefined;
    const arr = st.prices;
    const len = arr.length;
    let sum = 0;
    if (len < SMA_WINDOW) {
      for (let i = len - n; i < len; i++) sum += arr[i];
    } else {
      for (let i = 0; i < n; i++) {
        const idx = (st.nextPriceIndex - 1 - i + len * 2) % len;
        sum += arr[idx];
      }
    }
    return sum / n;
  }
}
