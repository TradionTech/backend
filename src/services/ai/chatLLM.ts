// Stub that you can wire to Groq/OpenAI
// Keep keys in env and call provider here.

export const chatLLM = {
  async generate(prompt: string): Promise<{ id: string; text: string; sources: string[] }> {
    // TODO: integrate real LLM (Groq/OpenAI)
    // For now, return deterministic stub
    return {
      id: 'resp_' + Math.random().toString(36).slice(2),
      text: `Stubbed response. Prompt snapshot: ${prompt.slice(0, 120)}...`,
      sources: ['CoinGecko', 'Binance', 'Finnhub', 'CryptoPanic']
    };
  }
};

