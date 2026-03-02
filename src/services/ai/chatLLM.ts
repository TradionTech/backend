/**
 * @deprecated This stub is deprecated. Use chatOrchestrator from './chatOrchestrator' instead.
 * The new implementation provides structured responses, intent detection, safety guardrails,
 * and conversation continuity.
 * 
 * This file is kept for backward compatibility but should not be used in new code.
 */
export const chatLLM = {
  async generate(prompt: string): Promise<{ id: string; text: string; sources: string[] }> {
    // Deprecated: Use chatOrchestrator.processMessage() instead
    return {
      id: 'resp_' + Math.random().toString(36).slice(2),
      text: `Stubbed response. Prompt snapshot: ${prompt.slice(0, 120)}...`,
      sources: ['CoinGecko', 'Binance', 'Finnhub', 'CryptoPanic']
    };
  }
};

