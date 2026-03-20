/**
 * Groq 429 (TPM/RPM) handling: parse suggested wait from error body and optional backoff.
 */

const TRY_AGAIN_IN_RE = /try again in\s+([\d.]+)\s*s\b/i;

/** Milliseconds to wait before retrying after a 429, or undefined if not parseable. */
export function parseGroq429RetryAfterMs(errorMessage: string): number | undefined {
  const m = errorMessage.match(TRY_AGAIN_IN_RE);
  if (!m) return undefined;
  const seconds = parseFloat(m[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.ceil(seconds * 1000) + 100;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prefer API "try again in Xs"; else exponential backoff (capped). */
export function compute429WaitMs(errorMessage: string, attemptIndexZero: number): number {
  const parsed = parseGroq429RetryAfterMs(errorMessage);
  if (parsed != null) return Math.min(parsed, 120_000);
  const backoff = Math.min(1000 * Math.pow(2, attemptIndexZero), 15_000);
  return backoff;
}
