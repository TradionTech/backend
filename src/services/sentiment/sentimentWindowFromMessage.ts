/**
 * Derive sentiment window (minutes) from user message or timeframe hint.
 * Used so "sentiment for the week" uses a 7-day window instead of the default 4-hour.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MINUTES_PER_MONTH = 30 * MINUTES_PER_DAY;
const MINUTES_PER_YEAR = 365 * MINUTES_PER_DAY;
const MAX_YEARS = 10;

/** Return minutes from start of current day (UTC) to the given date. */
export function getMinutesSinceStartOfDay(date: Date): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  return Math.floor((date.getTime() - start.getTime()) / (60 * 1000));
}

/** "Entire day so far" / "day so far" / "so far today" - match when we want from start of day to now. */
const DAY_SO_FAR_PATTERN = /\b(?:entire|full)\s+day\s+(?:so\s+far)?|\bday\s+so\s+far\b|\bso\s+far\s+today\b/i;

/** "N years" (e.g. "2 years", "3 years") - checked first so it wins over plain "year". */
const MULTI_YEAR_PATTERN = /\b(\d+)\s*years?\b/i;

/** "N weeks" (e.g. "2 weeks", "past 3 weeks") - checked before "week". */
const MULTI_WEEK_PATTERN = /\b(\d+)\s*weeks?\b/i;

/** "N days" (e.g. "5 days", "past 3 days") - checked before "day". */
const MULTI_DAY_PATTERN = /\b(\d+)\s*days?\b/i;

/** "N minutes" / "N mins" / "15m" style - common chart intervals (1-240 min). */
const MULTI_MINUTE_PATTERN = /\b(\d+)\s*(?:min(?:ute)?s?|m)\b/i;

/** "N hours" / "N hrs" / "N hours" / "2h" style - intraday (1-24 hours). */
const MULTI_HOUR_PATTERN = /\b(\d+)\s*(?:hr?s?|hours?|h)\b/i;

/** Patterns that indicate a requested window in the message (case-insensitive). */
const MESSAGE_PATTERNS: { pattern: RegExp; minutes: number }[] = [
  { pattern: /\b(for\s+(?:the\s+)?(?:this\s+)?)?month\b/i, minutes: MINUTES_PER_MONTH },
  { pattern: /\bmonthly\b/i, minutes: MINUTES_PER_MONTH },
  { pattern: /\b(for\s+(?:the\s+)?(?:this\s+)?)?week\b/i, minutes: MINUTES_PER_WEEK },
  { pattern: /\bweekly\b/i, minutes: MINUTES_PER_WEEK },
  { pattern: /\bfor\s+the\s+day\b/i, minutes: MINUTES_PER_DAY },
  { pattern: /\b(?:for\s+)?today\b/i, minutes: MINUTES_PER_DAY },
  { pattern: /\bdaily\b/i, minutes: MINUTES_PER_DAY },
  { pattern: /\b(?:last|past)\s+hour\b/i, minutes: MINUTES_PER_HOUR },
  { pattern: /\b(?:for\s+)?the\s+last\s+hour\b/i, minutes: MINUTES_PER_HOUR },
  { pattern: /\b(for\s+(?:the\s+)?(?:this\s+)?)?year\b/i, minutes: MINUTES_PER_YEAR },
  { pattern: /\byearly\b/i, minutes: MINUTES_PER_YEAR },
];

/** Timeframe hint values (from metadata or extractor) mapped to minutes. */
const HINT_TO_MINUTES: Record<string, number> = {
  // Intraday (chart-style)
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': MINUTES_PER_HOUR,
  '2h': 2 * MINUTES_PER_HOUR,
  '3h': 3 * MINUTES_PER_HOUR,
  '4h': 240,
  '1H': MINUTES_PER_HOUR,
  '2H': 2 * MINUTES_PER_HOUR,
  '3H': 3 * MINUTES_PER_HOUR,
  '4H': 240,
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: MINUTES_PER_HOUR,
  H2: 2 * MINUTES_PER_HOUR,
  H4: 240,
  // Day and above
  week: MINUTES_PER_WEEK,
  weekly: MINUTES_PER_WEEK,
  month: MINUTES_PER_MONTH,
  monthly: MINUTES_PER_MONTH,
  year: MINUTES_PER_YEAR,
  yearly: MINUTES_PER_YEAR,
  day: MINUTES_PER_DAY,
  daily: MINUTES_PER_DAY,
  today: MINUTES_PER_DAY,
  intraday: 240,
  '1d': MINUTES_PER_DAY,
  '1D': MINUTES_PER_DAY,
  '1w': MINUTES_PER_WEEK,
  '1W': MINUTES_PER_WEEK,
  '1y': MINUTES_PER_YEAR,
  '1Y': MINUTES_PER_YEAR,
};

/**
 * Get sentiment window in minutes from the user message and/or timeframe hint.
 * First checks the message for phrases like "for the week", "weekly", "for the day", then the hint.
 * For "entire day so far" / "day so far" / "so far today", pass optional `now` to get minutes from start of day to now.
 *
 * @param message User message (e.g. "What is the current sentiment for EURUSD for the week?")
 * @param timeframeHint Optional hint from metadata or extractor (e.g. "weekly", "5 days")
 * @param now Optional reference time; when provided and message says "day so far" / "entire day so far", returns minutes from start of that day (UTC) to now
 * @returns Window in minutes, or undefined to use config default (e.g. 240)
 */
export function getSentimentWindowMinutesFromRequest(
  message: string,
  timeframeHint?: string | null,
  now?: Date
): number | undefined {
  const normalizedMessage = message.trim();
  if (!normalizedMessage && !timeframeHint) return undefined;

  // "Entire day so far" / "day so far" / "so far today" → from start of day to now when `now` provided
  if (DAY_SO_FAR_PATTERN.test(normalizedMessage)) {
    const ref = now ?? new Date();
    const mins = getMinutesSinceStartOfDay(ref);
    return mins >= 1 ? mins : MINUTES_PER_DAY; // if same second as midnight, use full day
  }

  // Check "N years" first (e.g. "2 years", "5 years") so it wins over plain "year"
  const multiYearMatch = normalizedMessage.match(MULTI_YEAR_PATTERN);
  if (multiYearMatch) {
    const years = Math.min(parseInt(multiYearMatch[1], 10), MAX_YEARS);
    if (years >= 1) return years * MINUTES_PER_YEAR;
  }

  // "N weeks" (e.g. "2 weeks", "past 3 weeks")
  const multiWeekMatch = normalizedMessage.match(MULTI_WEEK_PATTERN);
  if (multiWeekMatch) {
    const weeks = Math.min(parseInt(multiWeekMatch[1], 10), 52);
    if (weeks >= 1) return weeks * MINUTES_PER_WEEK;
  }

  // "N days" (e.g. "5 days", "past 3 days")
  const multiDayMatch = normalizedMessage.match(MULTI_DAY_PATTERN);
  if (multiDayMatch) {
    const days = Math.min(parseInt(multiDayMatch[1], 10), 365);
    if (days >= 1) return days * MINUTES_PER_DAY;
  }

  // Intraday: "N minutes" / "N mins" / "15m" (1-240 min, common chart intervals)
  const multiMinMatch = normalizedMessage.match(MULTI_MINUTE_PATTERN);
  if (multiMinMatch) {
    const mins = Math.min(parseInt(multiMinMatch[1], 10), 240);
    if (mins >= 1) return mins;
  }

  // Intraday: "N hours" / "N hrs" / "2h" (1-24)
  const multiHourMatch = normalizedMessage.match(MULTI_HOUR_PATTERN);
  if (multiHourMatch) {
    const hours = Math.min(parseInt(multiHourMatch[1], 10), 24);
    if (hours >= 1) return hours * MINUTES_PER_HOUR;
  }

  for (const { pattern, minutes } of MESSAGE_PATTERNS) {
    if (pattern.test(normalizedMessage)) return minutes;
  }

  if (timeframeHint && typeof timeframeHint === 'string') {
    const hint = timeframeHint.trim().toLowerCase();
    const exact = HINT_TO_MINUTES[timeframeHint.trim()];
    if (exact != null) return exact;
    const lower = HINT_TO_MINUTES[hint];
    if (lower != null) return lower;
    // Parse "5 days", "2 weeks" style hints from extractor
    const hintWeeks = timeframeHint.trim().match(/^(\d+)\s*weeks?$/i);
    if (hintWeeks) {
      const w = Math.min(parseInt(hintWeeks[1], 10), 52);
      if (w >= 1) return w * MINUTES_PER_WEEK;
    }
    const hintDays = timeframeHint.trim().match(/^(\d+)\s*days?$/i);
    if (hintDays) {
      const d = Math.min(parseInt(hintDays[1], 10), 365);
      if (d >= 1) return d * MINUTES_PER_DAY;
    }
  }

  return undefined;
}
