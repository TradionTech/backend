/**
 * Shared throttle for Alpha Vantage API calls.
 *
 * Free tier allows ~1 request per second. This serializes all Alpha Vantage
 * requests (market data + news sentiment) so only one runs at a time with
 * a minimum interval between completions.
 * Set ALPHAVANTAGE_MIN_INTERVAL_MS=0 to disable when using premium.
 */

import { env } from '../config/env';
import { logger } from '../config/logger';

let lastRequestTime = 0;
/** Chain so only one request runs at a time; next waits for previous to finish then for min interval. */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Run a function only after the previous Alpha Vantage request has finished
 * and the minimum interval has elapsed. Ensures strict 1-at-a-time with spacing.
 *
 * @param fn Async function that performs the actual API call
 * @returns Result of fn()
 */
export async function withAlphaVantageThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const minIntervalMs = env.ALPHAVANTAGE_MIN_INTERVAL_MS ?? 0;
  if (minIntervalMs <= 0) {
    return fn();
  }

  const myTurn = tail
    .then(() => {
      const now = Date.now();
      const waitMs = Math.max(0, minIntervalMs - (now - lastRequestTime));
      if (waitMs > 0) {
        logger.debug('Alpha Vantage throttle: waiting before request', { waitMs });
        return new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    })
    .then(() => fn())
    .then((result) => {
      lastRequestTime = Date.now();
      return result;
    });

  tail = myTurn;
  return myTurn as Promise<T>;
}
