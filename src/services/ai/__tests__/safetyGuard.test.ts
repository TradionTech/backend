import { SafetyGuard } from '../safetyGuard';

describe('SafetyGuard', () => {
  let guard: SafetyGuard;

  beforeEach(() => {
    guard = new SafetyGuard();
  });

  describe('checkResponse', () => {
    it('should detect execution instructions', () => {
      const unsafeContent = 'You should buy a position at $50,000 now';
      const result = guard.checkResponse(unsafeContent);

      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('execution instructions');
      expect(result.fallbackMessage).toBeDefined();
    });

    it('should detect personalized advice with prices', () => {
      const unsafeContent = 'I recommend you buy Bitcoin at $60,000';
      const result = guard.checkResponse(unsafeContent);

      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('personalized financial advice');
    });

    it('should detect definitive predictions', () => {
      const unsafeContent = 'Bitcoin will definitely reach $100,000 by next month';
      const result = guard.checkResponse(unsafeContent);

      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('definitive price predictions');
    });

    it('should detect reckless behavior encouragement', () => {
      const unsafeContent = 'Just go all-in, it will be fine';
      const result = guard.checkResponse(unsafeContent);

      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('reckless trading behavior');
    });

    it('should pass safe educational content', () => {
      const safeContent = `**Facts:**
Bitcoin is a cryptocurrency that uses blockchain technology.

**Interpretation:**
The price of Bitcoin is influenced by supply and demand, market sentiment, and adoption.

**Risk & Uncertainty:**
Trading cryptocurrencies carries significant risk. Past performance doesn't guarantee future results.`;

      const result = guard.checkResponse(safeContent);

      expect(result.isSafe).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should not flag "all in" when it is a substring (e.g. "All information")', () => {
      const safeContent =
        '- **Source concentration:** All information originates from a single provider, so the view may be biased toward that source\'s coverage.';
      const result = guard.checkResponse(safeContent);
      expect(result.isSafe).toBe(true);
    });

    it('should pass content with uncertainty statements', () => {
      const safeContent = 'Based on limited information, the market may move in either direction. I cannot predict with certainty.';
      const result = guard.checkResponse(safeContent);

      expect(result.isSafe).toBe(true);
    });
  });
});
