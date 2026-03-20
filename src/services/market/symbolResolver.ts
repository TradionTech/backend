import type { AssetClass } from '../../types/market';
import { BARE_ISO_CURRENCY_CODES, inferAssetClass, toCanonicalFxSymbol } from './assetClassInferrer';

export interface SymbolResolutionInput {
  symbol?: string;
  assetClass?: AssetClass;
  rawQuery?: string;
}

export interface SymbolResolutionResult {
  symbol?: string;
  assetClass?: AssetClass;
  issues?: string[];
}

const EQUITY_NAME_TO_TICKER: Record<string, string> = {
  apple: 'AAPL',
  'apple inc': 'AAPL',
  microsoft: 'MSFT',
  'microsoft corporation': 'MSFT',
  tesla: 'TSLA',
  'tesla inc': 'TSLA',
  nvidia: 'NVDA',
  'nvidia corporation': 'NVDA',
  amazon: 'AMZN',
  'amazon.com': 'AMZN',
  google: 'GOOGL',
  alphabet: 'GOOGL',
  'alphabet inc': 'GOOGL',
  meta: 'META',
  'meta platforms': 'META',
  netflix: 'NFLX',
  'berkshire hathaway': 'BRK.B',
  jpmorgan: 'JPM',
  disney: 'DIS',
  visa: 'V',
  mastercard: 'MA',
  walmart: 'WMT',
  costco: 'COST',
  abbvie: 'ABBV',
  johnson: 'JNJ',
  'bank of america': 'BAC',
  exxon: 'XOM',
  chevron: 'CVX',
  oracle: 'ORCL',
  adobe: 'ADBE',
  salesforce: 'CRM',
  pepsico: 'PEP',
};

const COMMON_EQUITY_TICKERS = [
  'AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'JPM',
  'DIS', 'BAC', 'V', 'JNJ', 'WMT', 'PG', 'MA', 'UNH', 'COST', 'ABBV',
  'AMD', 'INTC', 'HD', 'XOM', 'CVX', 'SPY', 'QQQ', 'DIA', 'IWM', 'KO',
  'PFE', 'PEP', 'MRK', 'TMO', 'CSCO', 'ORCL', 'CRM', 'ADBE', 'MCD', 'BRK.B', 'BRKB',
];
const COMMON_CRYPTO_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'BNB', 'AVAX', 'DOT', 'LINK', 'LTC', 'UNI', 'ATOM', 'MATIC', 'POL'];
const COMMON_CRYPTO_QUOTES = ['USD', 'USDT', 'USDC', 'EUR', 'GBP'];

function damerauLevenshteinDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  const dp: number[][] = Array.from({ length: al + 1 }, () => Array(bl + 1).fill(0));

  for (let i = 0; i <= al; i++) dp[i][0] = i;
  for (let j = 0; j <= bl; j++) dp[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[al][bl];
}

function bestMatch(input: string, candidates: string[], maxDistance = 1): string | null {
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = damerauLevenshteinDistance(input, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    } else if (d === bestDist) {
      best = null;
    }
  }
  return bestDist <= maxDistance ? best : null;
}

function resolveSymbolFromCompanyName(rawQuery?: string): string | undefined {
  if (!rawQuery) return undefined;
  const q = rawQuery.toLowerCase();
  for (const [name, ticker] of Object.entries(EQUITY_NAME_TO_TICKER)) {
    if (q.includes(name)) {
      return ticker;
    }
  }
  return undefined;
}

function normalizeInputSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[\s/_-]/g, '');
}

function tryResolveFxSymbol(symbol: string): string | null {
  const s = normalizeInputSymbol(symbol);
  if (s.length === 3 && BARE_ISO_CURRENCY_CODES.has(s)) {
    return toCanonicalFxSymbol(s);
  }
  if (s.length !== 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);

  const baseOk = BARE_ISO_CURRENCY_CODES.has(base);
  const quoteOk = BARE_ISO_CURRENCY_CODES.has(quote);
  if (baseOk && quoteOk) return s;

  const isoCodes = Array.from(BARE_ISO_CURRENCY_CODES);
  const resolvedBase = baseOk ? base : bestMatch(base, isoCodes, 1);
  const resolvedQuote = quoteOk ? quote : bestMatch(quote, isoCodes, 1);
  if (resolvedBase && resolvedQuote && resolvedBase !== resolvedQuote) {
    return `${resolvedBase}${resolvedQuote}`;
  }
  return null;
}

function tryResolveCryptoSymbol(symbol: string): string | null {
  const s = normalizeInputSymbol(symbol);
  if (COMMON_CRYPTO_BASES.includes(s)) return s;

  for (const q of COMMON_CRYPTO_QUOTES) {
    if (s.endsWith(q) && s.length > q.length) {
      const base = s.slice(0, -q.length);
      if (COMMON_CRYPTO_BASES.includes(base)) return `${base}${q}`;
      const correctedBase = bestMatch(base, COMMON_CRYPTO_BASES, 1);
      if (correctedBase) return `${correctedBase}${q}`;
      return null;
    }
  }

  return bestMatch(s, COMMON_CRYPTO_BASES, 1);
}

function tryResolveEquitySymbol(symbol: string): string | null {
  const s = normalizeInputSymbol(symbol);
  if (COMMON_EQUITY_TICKERS.includes(s)) return s === 'BRKB' ? 'BRK.B' : s;

  const dotted = s.length > 1 ? `${s.slice(0, -1)}.${s.slice(-1)}` : s;
  if (COMMON_EQUITY_TICKERS.includes(dotted)) return dotted;

  const match = bestMatch(s, COMMON_EQUITY_TICKERS, 1);
  if (!match) return null;
  return match === 'BRKB' ? 'BRK.B' : match;
}

export function resolveMarketSymbol(input: SymbolResolutionInput): SymbolResolutionResult {
  const issues: string[] = [];
  let symbol = input.symbol?.trim();
  let assetClass = input.assetClass;

  if (!symbol) {
    symbol = resolveSymbolFromCompanyName(input.rawQuery);
    if (symbol) {
      issues.push(`symbol_inferred_from_company_name:${symbol}`);
    }
  }

  if (!symbol) {
    return { symbol: undefined, assetClass, issues: issues.length ? issues : undefined };
  }

  const original = symbol;
  const inferred = inferAssetClass(symbol);
  const targetClass = assetClass && assetClass !== 'OTHER' ? assetClass : inferred;
  let resolved = normalizeInputSymbol(symbol);

  if (targetClass === 'FX') {
    resolved = tryResolveFxSymbol(symbol) ?? resolved;
  } else if (targetClass === 'CRYPTO') {
    resolved = tryResolveCryptoSymbol(symbol) ?? resolved;
  } else if (targetClass === 'EQUITY' || targetClass === 'INDEX' || targetClass === 'OTHER') {
    resolved = tryResolveEquitySymbol(symbol) ?? resolved;
  }

  if (resolved !== normalizeInputSymbol(original)) {
    issues.push(`symbol_autocorrected:${normalizeInputSymbol(original)}->${resolved}`);
  }

  return {
    symbol: resolved,
    assetClass: targetClass === 'OTHER' ? inferAssetClass(resolved) : targetClass,
    issues: issues.length ? issues : undefined,
  };
}

