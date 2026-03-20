import { compute429WaitMs, parseGroq429RetryAfterMs } from '../groqRateLimit';

describe('groqRateLimit', () => {
  it('parses "try again in Xs" from Groq TPM message', () => {
    const msg =
      'Rate limit reached for model `openai/gpt-oss-120b` ... Please try again in 2.2125s. Need more tokens?';
    const ms = parseGroq429RetryAfterMs(msg);
    expect(ms).toBeDefined();
    expect(ms!).toBeGreaterThan(2200);
    expect(ms!).toBeLessThan(2400);
  });

  it('compute429WaitMs uses parsed value when present', () => {
    const msg = 'Please try again in 1.5s.';
    expect(compute429WaitMs(msg, 0)).toBeGreaterThan(1500);
  });

  it('compute429WaitMs falls back to exponential backoff when not parseable', () => {
    expect(compute429WaitMs('Something went wrong', 0)).toBe(1000);
    expect(compute429WaitMs('Something went wrong', 1)).toBe(2000);
  });
});
