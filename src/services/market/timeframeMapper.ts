import type { Timeframe, TimeframeUnit } from '../../types/market';

/**
 * Maps human-friendly timeframe terms to canonical Timeframe objects.
 * 
 * This is a pure function that handles common trading terminology:
 * - "scalp" / "scalping" → M1-M5 (very short term)
 * - "intraday" / "day trading" → M5-H1 (short term, same day)
 * - "swing" / "swing trading" → H4-D1 (medium term, days to weeks)
 * - "long term" / "position" → D1-W1+ (long term, weeks to months)
 * 
 * Also handles explicit timeframe strings like "1H", "4H", "D1", etc.
 */
export function mapTimeframeHint(hint: string): Timeframe | null {
  if (!hint || typeof hint !== 'string') {
    return null;
  }

  const normalized = hint.toLowerCase().trim();

  // Handle explicit timeframe strings (e.g., "1H", "4H", "D1", "M15")
  const explicitMatch = parseExplicitTimeframe(normalized);
  if (explicitMatch) {
    return explicitMatch;
  }

  // Handle human-friendly terms
  if (matchesScalping(normalized)) {
    // Scalping: very short term, use M5 as default
    return { unit: 'M', size: 5, label: '5 Minutes' };
  }

  if (matchesIntraday(normalized)) {
    // Intraday: short term, use H1 as default
    return { unit: 'H', size: 1, label: '1 Hour' };
  }

  if (matchesSwing(normalized)) {
    // Swing: medium term, use H4 as default
    return { unit: 'H', size: 4, label: '4 Hours' };
  }

  if (matchesLongTerm(normalized)) {
    // Long term: use D1 as default
    return { unit: 'D', size: 1, label: 'Daily' };
  }

  if (matchesMonthly(normalized)) {
    return { unit: 'Mo', size: 1, label: 'Monthly' };
  }

  return null;
}

/**
 * Parse explicit timeframe strings like "1H", "4H", "D1", "M15", "W1", "1Mo", "daily", "weekly"
 */
function parseExplicitTimeframe(hint: string): Timeframe | null {
  // Pattern: optional number + unit (M, H, D, W, Mo for month)
  const monthMatch = hint.match(/^(\d+)?mo(nth)?s?$/i);
  if (monthMatch) {
    const size = monthMatch[1] ? parseInt(monthMatch[1], 10) : 1;
    return { unit: 'Mo', size, label: size === 1 ? 'Monthly' : `${size} Months` };
  }

  // Full words used by price action ladder and API clients
  if (/^daily$|^day$/i.test(hint)) {
    return { unit: 'D', size: 1, label: 'Daily' };
  }
  if (/^weekly$|^week$/i.test(hint)) {
    return { unit: 'W', size: 1, label: 'Weekly' };
  }

  // Optional number + unit: "1h", "4h", "1d", "15m", "1w"
  const match = hint.match(/^(\d+)?([mhdw])$/i);
  // Unit + optional number: "D1", "H4", "M15", "W1"
  const unitFirstMatch = hint.match(/^([mhdw])(\d+)?$/i);
  const m = match || unitFirstMatch;
  if (!m) {
    return null;
  }
  const size = match
    ? (match[1] ? parseInt(match[1], 10) : 1)
    : (unitFirstMatch![2] ? parseInt(unitFirstMatch![2], 10) : 1);
  const unitChar = (match ? match[2] : unitFirstMatch![1]).toUpperCase();

  let unit: TimeframeUnit;
  let label: string;

  switch (unitChar) {
    case 'M':
      unit = 'M';
      label = size === 1 ? '1 Minute' : `${size} Minutes`;
      break;
    case 'H':
      unit = 'H';
      label = size === 1 ? '1 Hour' : `${size} Hours`;
      break;
    case 'D':
      unit = 'D';
      label = size === 1 ? 'Daily' : `${size} Days`;
      break;
    case 'W':
      unit = 'W';
      label = size === 1 ? 'Weekly' : `${size} Weeks`;
      break;
    default:
      return null;
  }

  return { unit, size, label };
}

/**
 * Check if hint matches scalping terminology
 */
function matchesScalping(hint: string): boolean {
  const scalpingTerms = ['scalp', 'scalping', 'scalper', 'scalped'];
  return scalpingTerms.some((term) => hint.includes(term));
}

/**
 * Check if hint matches intraday/day trading terminology
 */
function matchesIntraday(hint: string): boolean {
  const intradayTerms = [
    'intraday',
    'day trade',
    'day trading',
    'day trader',
    'same day',
    'intra-day',
  ];
  return intradayTerms.some((term) => hint.includes(term));
}

/**
 * Check if hint matches swing trading terminology
 */
function matchesSwing(hint: string): boolean {
  const swingTerms = ['swing', 'swing trade', 'swing trading', 'medium term', 'medium-term'];
  return swingTerms.some((term) => hint.includes(term));
}

/**
 * Check if hint matches long-term/position trading terminology
 */
function matchesLongTerm(hint: string): boolean {
  const longTermTerms = [
    'long term',
    'long-term',
    'position',
    'position trade',
    'position trading',
    'invest',
    'investment',
    'hold',
    'holding',
  ];
  return longTermTerms.some((term) => hint.includes(term));
}

/**
 * Check if hint matches monthly terminology
 */
function matchesMonthly(hint: string): boolean {
  const monthlyTerms = ['month', 'monthly'];
  return monthlyTerms.some((term) => hint.includes(term));
}

/**
 * Get a default timeframe based on asset class and trading style.
 * This can be used as a fallback when no explicit timeframe is provided.
 */
export function getDefaultTimeframe(
  assetClass?: string,
  tradingStyle?: string
): Timeframe {
  // If trading style is specified, use it
  if (tradingStyle) {
    const mapped = mapTimeframeHint(tradingStyle);
    if (mapped) {
      return mapped;
    }
  }

  // Default based on asset class
  switch (assetClass) {
    case 'FX':
      // FX traders often use H1-H4
      return { unit: 'H', size: 1, label: '1 Hour' };
    case 'CRYPTO':
      // Crypto often uses H1-D1
      return { unit: 'H', size: 4, label: '4 Hours' };
    case 'EQUITY':
      // Equities often use D1
      return { unit: 'D', size: 1, label: 'Daily' };
    default:
      // Default to H1
      return { unit: 'H', size: 1, label: '1 Hour' };
  }
}
