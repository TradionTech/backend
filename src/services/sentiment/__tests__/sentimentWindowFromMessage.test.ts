/**
 * Tests for sentiment window parsing from user message and timeframe hint.
 */
import {
  getSentimentWindowMinutesFromRequest,
  getMinutesSinceStartOfDay,
} from '../sentimentWindowFromMessage';

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MINUTES_PER_MONTH = 30 * MINUTES_PER_DAY;
const MINUTES_PER_YEAR = 365 * MINUTES_PER_DAY;
const MINUTES_PER_HOUR = 60;

describe('getSentimentWindowMinutesFromRequest', () => {
  it('should return week window for "for the week" in message', () => {
    expect(
      getSentimentWindowMinutesFromRequest('What is the current sentiment for EURUSD for the week?')
    ).toBe(MINUTES_PER_WEEK);
  });

  it('should return week window for "weekly" in message', () => {
    expect(getSentimentWindowMinutesFromRequest('Give me weekly sentiment for BTC')).toBe(
      MINUTES_PER_WEEK
    );
  });

  it('should return day window for "for the day" in message', () => {
    expect(
      getSentimentWindowMinutesFromRequest('What is the sentiment for AAPL for the day?')
    ).toBe(MINUTES_PER_DAY);
  });

  it('should return day window for "today" in message', () => {
    expect(getSentimentWindowMinutesFromRequest('Sentiment for EURUSD today')).toBe(
      MINUTES_PER_DAY
    );
  });

  it('should return month window for "for the month" in message', () => {
    expect(
      getSentimentWindowMinutesFromRequest('Show me sentiment for the month')
    ).toBe(MINUTES_PER_MONTH);
  });

  it('should use timeframeHint when message has no window phrase', () => {
    expect(getSentimentWindowMinutesFromRequest('Sentiment for BTC', 'weekly')).toBe(
      MINUTES_PER_WEEK
    );
    expect(getSentimentWindowMinutesFromRequest('Sentiment for BTC', '1W')).toBe(MINUTES_PER_WEEK);
  });

  it('should return undefined when no window in message or hint', () => {
    expect(getSentimentWindowMinutesFromRequest('What is the sentiment for EURUSD?')).toBeUndefined();
    expect(getSentimentWindowMinutesFromRequest('Sentiment for AAPL', undefined)).toBeUndefined();
  });

  it('should return 1 year for "for the year" and "yearly" in message', () => {
    expect(
      getSentimentWindowMinutesFromRequest('What is the sentiment for EURUSD for the year?')
    ).toBe(MINUTES_PER_YEAR);
    expect(getSentimentWindowMinutesFromRequest('Yearly sentiment for BTC')).toBe(MINUTES_PER_YEAR);
  });

  it('should return N years for "N years" in message (capped at 10)', () => {
    expect(getSentimentWindowMinutesFromRequest('Sentiment for the last 2 years')).toBe(
      2 * MINUTES_PER_YEAR
    );
    expect(getSentimentWindowMinutesFromRequest('How has AAPL done over 5 years?')).toBe(
      5 * MINUTES_PER_YEAR
    );
    expect(getSentimentWindowMinutesFromRequest('Sentiment over 1 year')).toBe(MINUTES_PER_YEAR);
  });

  it('should use timeframeHint "yearly" or "1Y" when message has no window phrase', () => {
    expect(getSentimentWindowMinutesFromRequest('Sentiment for BTC', 'yearly')).toBe(
      MINUTES_PER_YEAR
    );
    expect(getSentimentWindowMinutesFromRequest('Sentiment for AAPL', '1Y')).toBe(MINUTES_PER_YEAR);
  });

  it('should return intraday window for minute/hour phrases and chart-style shorthand', () => {
    expect(getSentimentWindowMinutesFromRequest('Sentiment on the 15m for EURUSD')).toBe(15);
    expect(getSentimentWindowMinutesFromRequest('What is sentiment on 1h?')).toBe(MINUTES_PER_HOUR);
    expect(getSentimentWindowMinutesFromRequest('Sentiment for the last 2 hours')).toBe(
      2 * MINUTES_PER_HOUR
    );
    expect(getSentimentWindowMinutesFromRequest('Past 30 minutes sentiment')).toBe(30);
    expect(getSentimentWindowMinutesFromRequest('Last hour sentiment for BTC')).toBe(
      MINUTES_PER_HOUR
    );
  });

  it('should use timeframeHint for chart intervals (15m, 1h, M15, H4)', () => {
    expect(getSentimentWindowMinutesFromRequest('Sentiment for EURUSD', '15m')).toBe(15);
    expect(getSentimentWindowMinutesFromRequest('Sentiment for AAPL', '1h')).toBe(
      MINUTES_PER_HOUR
    );
    expect(getSentimentWindowMinutesFromRequest('Sentiment', 'M15')).toBe(15);
    expect(getSentimentWindowMinutesFromRequest('Sentiment', 'H4')).toBe(240);
  });

  it('should return N days and N weeks from message and from hint', () => {
    expect(
      getSentimentWindowMinutesFromRequest('What is the current sentiment for EURUSD for the past 5 days?')
    ).toBe(5 * MINUTES_PER_DAY);
    expect(getSentimentWindowMinutesFromRequest('Sentiment for the last 2 weeks')).toBe(
      2 * MINUTES_PER_WEEK
    );
    expect(getSentimentWindowMinutesFromRequest('Sentiment for BTC', '5 days')).toBe(
      5 * MINUTES_PER_DAY
    );
    expect(getSentimentWindowMinutesFromRequest('Sentiment for EURUSD', '2 weeks')).toBe(
      2 * MINUTES_PER_WEEK
    );
  });

  it('should return minutes from start of day for "entire day so far" when now is passed', () => {
    // Noon UTC -> 12*60 = 720 minutes since start of day
    const noonUtc = new Date(Date.UTC(2026, 0, 15, 12, 0, 0, 0));
    expect(
      getSentimentWindowMinutesFromRequest('Sentiment for the entire day so far', undefined, noonUtc)
    ).toBe(720);
    expect(getMinutesSinceStartOfDay(noonUtc)).toBe(720);
    expect(
      getSentimentWindowMinutesFromRequest('What is sentiment for the day so far?', null, noonUtc)
    ).toBe(720);
  });
});
