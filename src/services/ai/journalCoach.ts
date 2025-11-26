export const journalCoach = {
  async analyze(input: {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entry: number;
    exit?: number | null;
    notes?: string | null;
  }) {
    // TODO: integrate LLM; use deterministic stub now
    const strengths = ['Good entry timing'];
    const mistakes = ['Early exit'];
    const tip = 'Consider holding until next key level, with a trailing stop.';

    return {
      score: 8,
      strengths,
      mistakes,
      tip
    };
  }
};

