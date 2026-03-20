import { extractSymbolHeuristicFromMessage } from '../marketContextIntentExtractor';

describe('extractSymbolHeuristicFromMessage', () => {
  it('extracts BTC from natural price questions', () => {
    expect(extractSymbolHeuristicFromMessage("What is the current price of BTC?")).toBe('BTC');
    expect(extractSymbolHeuristicFromMessage("What is the current price of btc?")).toBe('BTC');
  });

  it('extracts common FX pairs from letters-only string', () => {
    expect(extractSymbolHeuristicFromMessage('How is EURUSD looking')).toBe('EURUSD');
  });
});
