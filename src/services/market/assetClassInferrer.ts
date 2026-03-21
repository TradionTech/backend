import type { AssetClass } from '../../types/market';

/**
 * ISO 4217 and common currency codes (bare symbols that should be classified as FX).
 * Used to classify e.g. "GBP" as FX and to map to canonical pairs (GBPUSD) for providers.
 * Extended list; can be supplemented from a registry (e.g. ISO 4217) if needed.
 */
export const BARE_ISO_CURRENCY_CODES = new Set(
  [
    'USD',
    'EUR',
    'JPY',
    'GBP',
    'CHF',
    'AUD',
    'CAD',
    'NZD',
    'SEK',
    'NOK',
    'DKK',
    'SGD',
    'HKD',
    'CNY',
    'CNH',
    'KRW',
    'INR',
    'MXN',
    'BRL',
    'ZAR',
    'TRY',
    'PLN',
    'HUF',
    'CZK',
    'THB',
    'IDR',
    'MYR',
    'PHP',
    'TWD',
    'AED',
    'SAR',
    'QAR',
    'KWD',
    'BHD',
    'OMR',
    'ILS',
    'RUB',
    'RON',
    'BGN',
    'HRK',
    'RSD',
    'ISK',
    'GEL',
    'UAH',
    'ARS',
    'CLP',
    'COP',
    'PEN',
    'EGP',
    'NGN',
    'MAD',
    'KES',
    'PKR',
    'BDT',
    'LKR',
    'VND',
    'JMD',
    'DOP',
    'TTD',
    'XOF',
    'XAF',
    'XPF',
    'GHS',
    'ETB',
    // ISO 4217 precious metals (pairs like XAUUSD must not be fuzzy-matched to XAFUSD, etc.)
    'XAU',
    'XAG',
    'XPT',
    'XPD',
  ].map((c) => c.toUpperCase())
);

/**
 * Whether the symbol is a bare ISO-style currency code (e.g. GBP, EUR).
 * Used so we classify as FX and can map to a canonical pair for providers.
 */
export function isBareCurrencyCode(symbol: string): boolean {
  if (!symbol || typeof symbol !== 'string') return false;
  return BARE_ISO_CURRENCY_CODES.has(symbol.toUpperCase().trim());
}

/**
 * Map a bare currency code to the canonical FX pair symbol used by providers.
 * Preserves display in UI (e.g. "GBP") while APIs receive e.g. GBPUSD.
 * - USD -> EURUSD (default quote pair)
 * - JPY -> USDJPY (market convention)
 * - Others -> XXXUSD (e.g. GBPUSD, EURUSD)
 */
export function toCanonicalFxSymbol(symbol: string): string {
  if (!symbol || typeof symbol !== 'string') return symbol;
  const normalized = symbol.toUpperCase().trim();
  if (!BARE_ISO_CURRENCY_CODES.has(normalized)) return symbol;

  if (normalized === 'USD') return 'EURUSD';
  if (normalized === 'JPY') return 'USDJPY';
  return normalized + 'USD';
}

/**
 * Rule-based asset class inference from symbol names.
 *
 * This is a pure function that uses heuristics to classify symbols:
 * - Bare currency codes (GBP, EUR, etc.) -> FX
 * - FX pairs: typically 6 chars (EURUSD, GBPUSD, etc.)
 * - Crypto: common tickers like BTC, ETH, etc.
 * - Equities: stock tickers (typically 1-5 uppercase letters)
 * - Futures: often contain month codes or specific patterns
 * - Indices: common index symbols
 */
export function inferAssetClass(symbol: string, metadata?: { assetClass?: string }): AssetClass {
  if (!symbol || typeof symbol !== 'string') {
    return 'OTHER';
  }

  // If metadata explicitly provides asset class, use it (after validation)
  if (metadata?.assetClass) {
    const validAssetClasses: AssetClass[] = ['FX', 'EQUITY', 'CRYPTO', 'FUTURES', 'INDEX', 'OTHER'];
    if (validAssetClasses.includes(metadata.assetClass as AssetClass)) {
      return metadata.assetClass as AssetClass;
    }
  }

  const normalized = symbol.toUpperCase().trim();

  // Bare ISO currency code (e.g. GBP, EUR) -> FX so we don't misclassify as EQUITY
  if (BARE_ISO_CURRENCY_CODES.has(normalized)) {
    return 'FX';
  }

  // Check for FX pairs (e.g., EURUSD, GBPUSD, USDJPY, EURGBP)
  if (isForexPair(normalized)) {
    return 'FX';
  }

  // Check for crypto tickers
  if (isCryptoTicker(normalized)) {
    return 'CRYPTO';
  }

  // Check for index symbols
  if (isIndexSymbol(normalized)) {
    return 'INDEX';
  }

  // Check for futures patterns
  if (isFuturesSymbol(normalized)) {
    return 'FUTURES';
  }

  // Default to EQUITY for common stock-like patterns
  // (1-5 uppercase letters, possibly with numbers)
  if (isEquityLike(normalized)) {
    return 'EQUITY';
  }

  // Fallback to OTHER
  return 'OTHER';
}

/**
 * Check if symbol looks like a forex pair
 */
function isForexPair(symbol: string): boolean {
  // Common currency codes
  const currencyCodes = [
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'AUD',
    'CAD',
    'CHF',
    'NZD',
    'CNY',
    'HKD',
    'SGD',
    'SEK',
    'NOK',
    'DKK',
    'PLN',
    'ZAR',
    'MXN',
    'BRL',
    'INR',
    'KRW',
    'XAU',
    'XAG',
    'XPT',
    'XPD',
  ];

  // FX pairs are typically 6 characters (e.g., EURUSD, GBPUSD)
  // or 7-8 with separator (e.g., EUR/USD, EUR-USD)
  if (symbol.length >= 6 && symbol.length <= 8) {
    // Check if it contains two currency codes
    for (const base of currencyCodes) {
      for (const quote of currencyCodes) {
        if (base === quote) continue;

        // Direct concatenation (EURUSD)
        if (symbol === base + quote || symbol === quote + base) {
          return true;
        }

        // With separator (EUR/USD, EUR-USD, EUR_USD)
        const separators = ['/', '-', '_'];
        for (const sep of separators) {
          if (symbol === `${base}${sep}${quote}` || symbol === `${quote}${sep}${base}`) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Check if symbol is a known crypto ticker
 */
function isCryptoTicker(symbol: string): boolean {
  // Common crypto tickers (major cryptocurrencies)
  const cryptoTickers = [
    'BTC',
    'ETH',
    'BNB',
    'SOL',
    'XRP',
    'ADA',
    'DOGE',
    'DOT',
    'MATIC',
    'AVAX',
    'LINK',
    'UNI',
    'LTC',
    'ATOM',
    'ETC',
    'XLM',
    'ALGO',
    'VET',
    'ICP',
    'FIL',
    'TRX',
    'EOS',
    'AAVE',
    'MKR',
    'COMP',
    'SUSHI',
    'YFI',
    'SNX',
    'CRV',
    '1INCH',
    // Stablecoins
    'USDT',
    'USDC',
    'DAI',
    'BUSD',
    'TUSD',
    // Wrapped tokens
    'WBTC',
    'WETH',
  ];

  // Direct match
  if (cryptoTickers.includes(symbol)) {
    return true;
  }

  // Pattern: symbol might be prefixed with exchange or have suffix
  // e.g., BTCUSDT, ETHUSD, BTC-PERP
  const cryptoPatterns = [
    /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|DOT|MATIC|AVAX)/i,
    /USDT?$/i, // Ends with USD or USDT
    /-PERP$/i, // Perpetual futures
  ];

  return cryptoPatterns.some((pattern) => pattern.test(symbol));
}

/**
 * Check if symbol is an index
 */
function isIndexSymbol(symbol: string): boolean {
  // Common index symbols
  const indexSymbols = [
    'SPX',
    'SPY',
    'DJI',
    'DJIA',
    'NDX',
    'QQQ',
    'RUT',
    'VIX',
    'FTSE',
    'DAX',
    'CAC',
    'NIKKEI',
    'HSI',
    'ASX',
    'SP500',
    'DOW',
    'NASDAQ',
    'RUSSELL',
  ];

  if (indexSymbols.includes(symbol)) {
    return true;
  }

  // Pattern: often contains "INDEX", "IDX", or numbers
  const indexPatterns = [
    /INDEX$/i,
    /IDX$/i,
    /^\d+$/i, // Pure numbers (some indices)
  ];

  return indexPatterns.some((pattern) => pattern.test(symbol));
}

/**
 * Check if symbol looks like a futures contract
 */
function isFuturesSymbol(symbol: string): boolean {
  // Futures often have month codes (F, G, H, J, K, M, N, Q, U, V, X, Z)
  // or year codes, or specific suffixes
  const futuresPatterns = [
    /[FGHJKMNQUVXZ]\d{2}$/i, // Month code + 2 digits (e.g., CLZ24)
    /-FUT$/i, // Futures suffix
    /PERP$/i, // Perpetual
    /CONT$/i, // Continuous
  ];

  return futuresPatterns.some((pattern) => pattern.test(symbol));
}

/**
 * Check if symbol looks like an equity ticker
 */
function isEquityLike(symbol: string): boolean {
  // Equity tickers are typically:
  // - 1-5 uppercase letters (e.g., AAPL, MSFT, TSLA)
  // - May contain numbers (e.g., BRK.B, 3M)
  // - Usually no special characters (except dots for classes)

  // Simple pattern: mostly letters, possibly with numbers and dots
  const equityPattern = /^[A-Z]{1,5}(\.[A-Z])?(\d+)?$/;

  return equityPattern.test(symbol) && symbol.length <= 8;
}
