/**
 * Alpha Vantage Provider-Specific Quirks
 *
 * This file is the single source of truth for all Alpha Vantage-specific logic:
 * - Function and interval mapping (AssetClass + Timeframe → Alpha Vantage API params)
 * - Response parsing for different Alpha Vantage response shapes
 * - Error and rate-limit detection
 * - Symbol formatting (FX pairs, crypto, etc.)
 *
 * Any future tweaks for Alpha Vantage should be made here, not scattered in the service.
 * This centralization makes it easy to:
 * - Understand provider limitations
 * - Adjust mappings as Alpha Vantage API evolves
 * - Test provider-specific logic in isolation
 */

import { logger } from '../../../config/logger';
import type {
  MarketContextRequest,
  AssetClass,
  Timeframe,
  RawMarketData,
} from '../../../types/market';

/**
 * Alpha Vantage API parameters for a request
 */
export interface AlphaVantageParams {
  /** Alpha Vantage function name (e.g., "TIME_SERIES_INTRADAY", "FX_DAILY") */
  func: string;
  /** Symbol parameters - varies by asset class (e.g., { symbol: 'IBM' } or { from_symbol: 'EUR', to_symbol: 'USD' }) */
  symbolParam: Record<string, string>;
  /** Interval for intraday functions (e.g., "1min", "5min", "15min", "30min", "60min") */
  interval?: string;
  /** Whether we degraded from requested timeframe (e.g., intraday → daily) */
  degraded?: boolean;
  /** Reason for degradation, if any */
  degradationReason?: string;
}

/**
 * Alpha Vantage error information
 */
export interface AlphaVantageErrorInfo {
  isError: boolean;
  reason?: 'RATE_LIMIT' | 'INVALID_CALL' | 'UNKNOWN';
  rawMessage?: string;
}

/**
 * Map a market context request to Alpha Vantage API parameters.
 *
 * Handles:
 * - Asset class → function selection (TIME_SERIES_INTRADAY, FX_DAILY, DIGITAL_CURRENCY_DAILY, etc.)
 * - Timeframe → interval selection (1min, 5min, 15min, 30min, 60min for intraday)
 * - FX pair symbol splitting (EURUSD → from_symbol=EUR, to_symbol=USD)
 * - FX / crypto intraday via FX_INTRADAY and DIGITAL_CURRENCY_INTRADAY (paid Alpha Vantage)
 */
export function mapRequestToAlphaParams(
  request: MarketContextRequest,
  timeframe: Timeframe | undefined,
  assetClass: AssetClass
): AlphaVantageParams {
  const symbol = request.symbol;
  if (!symbol) {
    throw new Error('Symbol is required for Alpha Vantage API');
  }

  // Handle FX pairs
  if (assetClass === 'FX') {
    return mapFxRequest(symbol, timeframe);
  }

  // Handle Crypto
  if (assetClass === 'CRYPTO') {
    return mapCryptoRequest(symbol, timeframe);
  }

  // Handle Equity (default)
  return mapEquityRequest(symbol, timeframe);
}

/**
 * Parse crypto symbol and fiat market for Alpha Vantage (DIGITAL_CURRENCY_* and CURRENCY_EXCHANGE_RATE).
 */
export function parseAlphaCryptoSymbol(symbol: string): { cryptoSymbol: string; market: string } {
  const cryptoMatch = symbol.match(/^([A-Z]+)[\/\-_]([A-Z]+)$/i);
  if (cryptoMatch) {
    return {
      cryptoSymbol: cryptoMatch[1].toUpperCase(),
      market: cryptoMatch[2].toUpperCase(),
    };
  }
  const u = symbol.toUpperCase();
  const commonMarkets = ['USD', 'EUR', 'GBP', 'JPY', 'CNY'];
  for (const mkt of commonMarkets) {
    if (u.endsWith(mkt) && u.length > mkt.length) {
      return { cryptoSymbol: u.slice(0, -mkt.length), market: mkt };
    }
  }
  return { cryptoSymbol: u, market: 'USD' };
}

/**
 * Map FX request to Alpha Vantage FX function
 */
function mapFxRequest(symbol: string, timeframe: Timeframe | undefined): AlphaVantageParams {
  // Split FX pair (e.g., EURUSD → EUR, USD)
  const fxMatch = symbol.match(/^([A-Z]{3})([A-Z]{3})$/);
  if (!fxMatch) {
    throw new Error(`Invalid FX pair format: ${symbol}. Expected format: EURUSD`);
  }

  const fromSymbol = fxMatch[1];
  const toSymbol = fxMatch[2];

  // Intraday: FX_INTRADAY (premium / paid plans)
  if (timeframe && (timeframe.unit === 'M' || timeframe.unit === 'H')) {
    const interval = mapTimeframeToInterval(timeframe);
    return {
      func: 'FX_INTRADAY',
      symbolParam: {
        from_symbol: fromSymbol,
        to_symbol: toSymbol,
      },
      interval,
    };
  }

  // Map timeframe to FX function
  if (!timeframe || timeframe.unit === 'D') {
    return {
      func: 'FX_DAILY',
      symbolParam: {
        from_symbol: fromSymbol,
        to_symbol: toSymbol,
      },
    };
  }

  if (timeframe.unit === 'W') {
    return {
      func: 'FX_WEEKLY',
      symbolParam: {
        from_symbol: fromSymbol,
        to_symbol: toSymbol,
      },
    };
  }

  if (timeframe.unit === 'Mo') {
    return {
      func: 'FX_MONTHLY',
      symbolParam: {
        from_symbol: fromSymbol,
        to_symbol: toSymbol,
      },
    };
  }

  // Default to daily
  return {
    func: 'FX_DAILY',
    symbolParam: {
      from_symbol: fromSymbol,
      to_symbol: toSymbol,
    },
  };
}

/**
 * Map Crypto request to Alpha Vantage Crypto function
 *
 * Alpha Vantage uses DIGITAL_CURRENCY_DAILY, DIGITAL_CURRENCY_WEEKLY, DIGITAL_CURRENCY_MONTHLY
 * Symbols can be in format "BTC" or "BTC/USD" - we need to parse and extract crypto symbol and market
 */
function mapCryptoRequest(symbol: string, timeframe: Timeframe | undefined): AlphaVantageParams {
  const { cryptoSymbol, market } = parseAlphaCryptoSymbol(symbol);

  // Intraday: DIGITAL_CURRENCY_INTRADAY (paid tier)
  if (timeframe && (timeframe.unit === 'M' || timeframe.unit === 'H')) {
    const interval = mapTimeframeToInterval(timeframe);
    return {
      func: 'DIGITAL_CURRENCY_INTRADAY',
      symbolParam: {
        symbol: cryptoSymbol,
        market,
      },
      interval,
    };
  }

  // Map timeframe to Crypto function (M = minutes = intraday; Mo = month)
  if (!timeframe || timeframe.unit === 'D') {
    return {
      func: 'DIGITAL_CURRENCY_DAILY',
      symbolParam: {
        symbol: cryptoSymbol,
        market: market,
      },
    };
  }

  if (timeframe.unit === 'W') {
    return {
      func: 'DIGITAL_CURRENCY_WEEKLY',
      symbolParam: {
        symbol: cryptoSymbol,
        market: market,
      },
    };
  }

  if (timeframe.unit === 'Mo') {
    return {
      func: 'DIGITAL_CURRENCY_MONTHLY',
      symbolParam: {
        symbol: cryptoSymbol,
        market: market,
      },
    };
  }

  // Default to daily
  return {
    func: 'DIGITAL_CURRENCY_DAILY',
    symbolParam: {
      symbol: cryptoSymbol,
      market: market,
    },
  };
}

/**
 * Map Equity request to Alpha Vantage Equity function
 */
function mapEquityRequest(symbol: string, timeframe: Timeframe | undefined): AlphaVantageParams {
  // Alpha Vantage Equity functions:
  // - TIME_SERIES_INTRADAY (for intraday: 1min, 5min, 15min, 30min, 60min)
  // - TIME_SERIES_DAILY, TIME_SERIES_WEEKLY, TIME_SERIES_MONTHLY

  // Handle intraday timeframes
  if (timeframe && (timeframe.unit === 'M' || timeframe.unit === 'H')) {
    const interval = mapTimeframeToInterval(timeframe);
    return {
      func: 'TIME_SERIES_INTRADAY',
      symbolParam: {
        symbol: symbol,
      },
      interval: interval,
    };
  }

  // Handle daily/weekly/monthly
  if (!timeframe || timeframe.unit === 'D') {
    return {
      func: 'TIME_SERIES_DAILY',
      symbolParam: {
        symbol: symbol,
      },
    };
  }

  if (timeframe.unit === 'W') {
    return {
      func: 'TIME_SERIES_WEEKLY',
      symbolParam: {
        symbol: symbol,
      },
    };
  }

  if (timeframe.unit === 'Mo') {
    return {
      func: 'TIME_SERIES_MONTHLY',
      symbolParam: {
        symbol: symbol,
      },
    };
  }

  // Default to daily
  return {
    func: 'TIME_SERIES_DAILY',
    symbolParam: {
      symbol: symbol,
    },
  };
}

/**
 * Map timeframe to Alpha Vantage interval string.
 * Alpha Vantage supports: 1min, 5min, 15min, 30min, 60min
 */
function mapTimeframeToInterval(timeframe: Timeframe): string {
  if (timeframe.unit === 'M') {
    // Map minutes to nearest supported interval
    const minutes = timeframe.size;
    if (minutes <= 1) return '1min';
    if (minutes <= 5) return '5min';
    if (minutes <= 15) return '15min';
    if (minutes <= 30) return '30min';
    if (minutes <= 60) return '60min';
    // If > 60 minutes, fall back to 60min
    return '60min';
  }

  if (timeframe.unit === 'H') {
    // Hours - convert to minutes and map
    const minutes = timeframe.size * 60;
    if (minutes <= 5) return '5min';
    if (minutes <= 15) return '15min';
    if (minutes <= 30) return '30min';
    if (minutes <= 60) return '60min';
    // If > 60 minutes, use 60min
    return '60min';
  }

  // Default to 5min for unknown intraday
  return '5min';
}

/**
 * Parse Alpha Vantage time series response into RawMarketData.
 *
 * Handles different response shapes:
 * - "Time Series (5min)" for intraday equity
 * - "Time Series (Daily)" for daily equity
 * - "Time Series FX (Daily)" for FX
 * - "Time Series (Digital Currency Daily)" for crypto
 */
export function parseTimeSeriesResponse(
  json: any,
  params: AlphaVantageParams,
  originalSymbol: string,
  assetClass: AssetClass
): RawMarketData {
  // Find the time series key in the response
  const timeSeriesKey = findTimeSeriesKey(json, params.func, params.interval);

  if (!timeSeriesKey || !json[timeSeriesKey]) {
    throw new Error(
      `No time series data found in Alpha Vantage response. Keys: ${Object.keys(json).join(', ')}`
    );
  }

  const timeSeries = json[timeSeriesKey];
  const candles: RawMarketData['candles'] = [];

  // Parse each timestamp entry
  for (const [timestampStr, data] of Object.entries(timeSeries)) {
    const entry = data as any;

    // Alpha Vantage uses consistent field names across functions:
    // - Equity: "1. open", "2. high", "3. low", "4. close", "5. volume"
    // - FX: "1. open", "2. high", "3. low", "4. close"
    // - Crypto: "1a. open (USD)", "2a. high (USD)", "3a. low (USD)", "4a. close (USD)", "5. volume"
    const open = parseFloat(entry['1. open'] || entry['1a. open (USD)'] || entry['open'] || '0');
    const high = parseFloat(entry['2. high'] || entry['2a. high (USD)'] || entry['high'] || '0');
    const low = parseFloat(entry['3. low'] || entry['3a. low (USD)'] || entry['low'] || '0');
    const close = parseFloat(
      entry['4. close'] || entry['4a. close (USD)'] || entry['close'] || '0'
    );
    const volume =
      entry['5. volume'] || entry['volume']
        ? parseFloat(entry['5. volume'] || entry['volume'])
        : undefined;

    // Parse timestamp - Alpha Vantage uses different formats
    let timestamp: number;
    const intradaySeries =
      params.func === 'TIME_SERIES_INTRADAY' ||
      params.func === 'FX_INTRADAY' ||
      params.func === 'DIGITAL_CURRENCY_INTRADAY';
    if (intradaySeries) {
      timestamp = new Date(timestampStr.replace(' ', 'T') + 'Z').getTime();
    } else if (params.func.startsWith('FX_') || params.func.startsWith('DIGITAL_CURRENCY_')) {
      timestamp = new Date(timestampStr + 'T00:00:00Z').getTime();
    } else {
      timestamp = new Date(timestampStr + 'T00:00:00Z').getTime();
    }

    // Skip invalid entries
    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      continue;
    }

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  // Sort candles by timestamp ascending (oldest first)
  candles.sort((a, b) => a.timestamp - b.timestamp);

  // Extract most recent candle for lastPrice and timestamp
  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;
  const lastPrice = latestCandle?.close;
  const timestamp = latestCandle?.timestamp;

  // Extract base/quote for FX pairs
  let base: string | undefined;
  let quote: string | undefined;
  if (assetClass === 'FX' && params.symbolParam.from_symbol && params.symbolParam.to_symbol) {
    base = params.symbolParam.from_symbol;
    quote = params.symbolParam.to_symbol;
  }

  // Build issues array if there was degradation
  const issues: string[] = [];
  if (params.degraded && params.degradationReason) {
    issues.push(params.degradationReason);
  }

  return {
    symbol: originalSymbol,
    assetClass,
    candles: candles.length > 0 ? candles : undefined,
    lastPrice,
    timestamp,
    provider: 'alpha_vantage',
    base,
    quote,
    issues: issues.length > 0 ? issues : undefined,
  };
}

/**
 * Candidate JSON keys for OHLCV time series, ordered by specificity for the requested function.
 */
function buildTimeSeriesKeyCandidates(func: string, interval?: string): string[] {
  const keys: string[] = [];

  if (func === 'TIME_SERIES_INTRADAY' && interval) {
    keys.push(`Time Series (${interval})`);
  }
  if (func === 'FX_INTRADAY' && interval) {
    keys.push(`Time Series FX (${interval})`);
  }
  if (func === 'DIGITAL_CURRENCY_INTRADAY' && interval) {
    keys.push(`Time Series (Digital Currency ${interval})`);
    keys.push(`Time Series Crypto (${interval})`);
  }

  keys.push(
    'Time Series (Daily)',
    'Weekly Time Series',
    'Monthly Time Series',
    'Time Series FX (Daily)',
    'Time Series FX (Weekly)',
    'Time Series FX (Monthly)',
    'FX Daily Time Series',
    'Time Series (Digital Currency Daily)',
    'Time Series (Digital Currency Weekly)',
    'Time Series (Digital Currency Monthly)'
  );

  if (interval && !keys.includes(`Time Series (${interval})`)) {
    keys.push(`Time Series (${interval})`);
  }

  return keys;
}

/**
 * Find the time series key in Alpha Vantage response.
 * Different functions use different key names; paid intraday variants vary slightly.
 */
function findTimeSeriesKey(json: any, func: string, interval?: string): string | null {
  for (const key of buildTimeSeriesKeyCandidates(func, interval)) {
    if (json[key] && typeof json[key] === 'object') {
      return key;
    }
  }

  for (const key of Object.keys(json)) {
    if (key.startsWith('Time Series') && json[key] && typeof json[key] === 'object') {
      return key;
    }
  }

  if (json['Information']) {
    logger.error(
      `No time series key found in Alpha Vantage response. Information: ${json['Information']}`
    );
    return null;
  }

  return null;
}

/**
 * Detect Alpha Vantage-specific errors and rate limits.
 *
 * Alpha Vantage signals errors via:
 * - "Error Message" field → invalid API call
 * - "Note" field with rate limit language → rate limit
 * - "Information" field → often contains error or informational messages
 */
export function detectAlphaVantageError(json: any): AlphaVantageErrorInfo {
  // Check for explicit error message
  if (json['Error Message']) {
    return {
      isError: true,
      reason: 'INVALID_CALL',
      rawMessage: json['Error Message'],
    };
  }

  // Check for "Information" field - often contains rate limit or error messages
  // e.g., "Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second)..."
  if (json['Information']) {
    const info = String(json['Information']).toLowerCase();
    // Invalid API / function
    if (info.includes('does not exist') || info.includes('invalid') || info.includes('not found')) {
      return {
        isError: true,
        reason: 'INVALID_CALL',
        rawMessage: json['Information'],
      };
    }
    // Rate limit: "1 request per second", "spreading out", "API call frequency", "premium"
    if (
      info.includes('per second') ||
      info.includes('spreading out') ||
      info.includes('api call frequency') ||
      info.includes('rate limit') ||
      info.includes('thank you for using alpha vantage')
    ) {
      return {
        isError: true,
        reason: 'RATE_LIMIT',
        rawMessage: json['Information'],
      };
    }
  }

  // Check for rate limit note
  if (json['Note']) {
    const note = json['Note'].toLowerCase();
    // Alpha Vantage rate limit messages typically mention:
    // - "API call frequency"
    // - "Thank you for using Alpha Vantage"
    // - "premium" or "upgrade"
    if (
      note.includes('api call frequency') ||
      note.includes('premium') ||
      note.includes('upgrade') ||
      note.includes('thank you for using')
    ) {
      return {
        isError: true,
        reason: 'RATE_LIMIT',
        rawMessage: json['Note'],
      };
    }
  }

  // Check for informational note (not necessarily an error)
  // Some responses have "Note" with informational content
  // We only treat it as an error if it's clearly a rate limit

  return {
    isError: false,
  };
}

/** Parsed realtime / global quote for merging onto time-series snapshots */
export interface AlphaQuoteEnrichment {
  lastPrice: number;
  timestamp: number;
}

/**
 * CURRENCY_EXCHANGE_RATE — forex and crypto-fiat spot (uses Last Refreshed when present).
 */
export function parseCurrencyExchangeRateResponse(json: any): AlphaQuoteEnrichment | null {
  const rate = json?.['Realtime Currency Exchange Rate'];
  if (!rate || typeof rate !== 'object') {
    return null;
  }
  const rawPrice =
    rate['5. Exchange Rate'] ?? rate['5. exchange rate'] ?? rate['5. Exchange rate'];
  const price = parseFloat(String(rawPrice ?? ''));
  if (Number.isNaN(price)) {
    return null;
  }
  const refreshed = rate['6. Last Refreshed'] ?? rate['6. last refreshed'] ?? '';
  let ts = Date.now();
  if (refreshed) {
    const parsed = new Date(String(refreshed).replace(' ', 'T') + 'Z').getTime();
    if (!Number.isNaN(parsed)) {
      ts = parsed;
    }
  }
  return { lastPrice: price, timestamp: ts };
}

/**
 * GLOBAL_QUOTE — equity last price (uses latest trading day as coarse timestamp).
 */
export function parseGlobalQuoteResponse(json: any): AlphaQuoteEnrichment | null {
  const q = json?.['Global Quote'];
  if (!q || typeof q !== 'object') {
    return null;
  }
  const rawPrice = q['05. price'] ?? q['5. price'] ?? q['05. Price'];
  const price = parseFloat(String(rawPrice ?? ''));
  if (Number.isNaN(price)) {
    return null;
  }
  const day = q['07. latest trading day'] ?? q['7. latest trading day'] ?? '';
  let ts = Date.now();
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(String(day))) {
    const parsed = new Date(`${day}T20:00:00.000Z`).getTime();
    if (!Number.isNaN(parsed)) {
      ts = parsed;
    }
  }
  return { lastPrice: price, timestamp: ts };
}
