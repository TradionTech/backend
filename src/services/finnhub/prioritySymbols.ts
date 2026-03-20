/**
 * Priority symbols for Finnhub WebSocket (live trades).
 * Free tier: 50 symbols per connection (https://finnhub.io/pricing).
 * Order: Forex (incl. gold/silver) → Crypto → US equities.
 */

/** Finnhub free-tier limit: 50 symbols per WebSocket connection */
export const FINNHUB_WS_SYMBOL_LIMIT = 50;

/**
 * Default set of symbols to subscribe to (up to FINNHUB_WS_SYMBOL_LIMIT).
 * - Forex first (major pairs + commodities XAU/USD, XAG/USD via OANDA)
 * - Crypto: major pairs on Binance
 * - US equities: mega-caps and volume leaders
 */
export const DEFAULT_PRIORITY_SYMBOLS: string[] = [
  // Forex (OANDA) – major pairs + gold & silver
  'OANDA:EUR_USD',
  'OANDA:GBP_USD',
  'OANDA:USD_JPY',
  'OANDA:AUD_USD',
  'OANDA:USD_CHF',
  'OANDA:NZD_USD',
  'OANDA:USD_CAD',
  'OANDA:EUR_GBP',
  'OANDA:EUR_JPY',
  'OANDA:XAU_USD',  // Gold
  'OANDA:XAG_USD',  // Silver
  // Crypto (Finnhub format: EXCHANGE:PAIR)
  'BINANCE:BTCUSDT',
  'BINANCE:ETHUSDT',
  'BINANCE:BNBUSDT',
  'BINANCE:SOLUSDT',
  'BINANCE:XRPUSDT',
  'BINANCE:ADAUSDT',
  'BINANCE:DOGEUSDT',
  'BINANCE:AVAXUSDT',
  'BINANCE:DOTUSDT',
  'BINANCE:LINKUSDT',
  'BINANCE:POLUSDT',
  'BINANCE:LTCUSDT',
  'BINANCE:UNIUSDT',
  'BINANCE:ATOMUSDT',
  // US equities – mega caps and volume leaders (25 to stay within 50 total)
  'SPY',
  'MSFT',
  'GOOGL',
  'AMZN',
  'NVDA',
  'META',
  'TSLA',
  'QQQ',
  'DIA',
  'AMD',
  'INTC',
  'NFLX',
  'IWM',
  'KO',
  'PFE',
  'PEP',
  'MRK',
  'TMO',
  'CSCO',
  'ORCL',
  'HD',
  'XOM',
  'CVX',
  'CRM',
  'ADBE',
];

/**
 * Reserve pool used for runtime replacement when a subscribed symbol is silent for too long.
 * Keep symbols liquid and widely covered by Finnhub trade stream.
 */
export const FALLBACK_ROTATION_SYMBOLS: string[] = [
  'OANDA:GBP_JPY',
  'OANDA:EUR_CHF',
  'OANDA:EUR_AUD',
  'OANDA:GBP_CHF',
  'BINANCE:BTCUSD',
  'BINANCE:ETHUSD',
  'BINANCE:TRXUSDT',
  'BINANCE:BCHUSDT',
  'BINANCE:ETCUSDT',
  'BINANCE:NEARUSDT',
  'AAPL',
  'JPM',
  'WMT',
  'COST',
  'ABBV',
  'MA',
  'UNH',
  'PG',
  'BAC',
  'JNJ',
  'AVGO',
  'PLTR',
  'SNOW',
  'SHOP',
];

/**
 * Returns the list of symbols to subscribe to, capped at maxSymbols.
 * If override is provided (e.g. from env), it is truncated to maxSymbols.
 */
export function getPrioritySymbols(
  override: string[] | undefined,
  maxSymbols: number = FINNHUB_WS_SYMBOL_LIMIT
): string[] {
  const raw = override?.length
    ? override.map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_PRIORITY_SYMBOLS;
  return [...new Set(raw)].slice(0, maxSymbols);
}

export function getRotationCandidates(activeSymbols: string[]): string[] {
  const used = new Set(activeSymbols.map((s) => s.toUpperCase()));
  const merged = [...DEFAULT_PRIORITY_SYMBOLS, ...FALLBACK_ROTATION_SYMBOLS];
  return [...new Set(merged.map((s) => s.toUpperCase()))].filter((s) => !used.has(s));
}
