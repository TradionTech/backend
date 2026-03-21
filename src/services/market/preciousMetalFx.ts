/**
 * ISO 4217 precious metals as FX pairs (e.g. XAUUSD, XAGUSD).
 * Alpha Vantage FX intraday for these pairs is spot-oriented; Twelve Data time_series provides OHLC.
 */

/** 6-char pair: metal (XAU|XAG|XPT|XPD) + quote ISO (USD, EUR, ...). */
export function isPreciousMetalFxPair(symbol: string): boolean {
  const u = symbol.trim().toUpperCase();
  return /^(XAU|XAG|XPT|XPD)([A-Z]{3})$/.test(u);
}

/** Twelve Data forex symbols use a slash: XAU/USD. */
export function toTwelveDataFxSymbol(symbol: string): string {
  const u = symbol.trim().toUpperCase();
  const m = u.match(/^([A-Z]{3})([A-Z]{3})$/);
  if (!m) return u;
  return `${m[1]}/${m[2]}`;
}
