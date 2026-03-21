import { isPreciousMetalFxPair, toTwelveDataFxSymbol } from '../preciousMetalFx';

describe('preciousMetalFx', () => {
  it('detects precious metal FX pairs', () => {
    expect(isPreciousMetalFxPair('XAUUSD')).toBe(true);
    expect(isPreciousMetalFxPair('xauusd')).toBe(true);
    expect(isPreciousMetalFxPair('XAGUSD')).toBe(true);
    expect(isPreciousMetalFxPair('XPTUSD')).toBe(true);
    expect(isPreciousMetalFxPair('XPDUSD')).toBe(true);
    expect(isPreciousMetalFxPair('XAUEUR')).toBe(true);
  });

  it('rejects non-metal FX', () => {
    expect(isPreciousMetalFxPair('EURUSD')).toBe(false);
    expect(isPreciousMetalFxPair('XAFUSD')).toBe(false);
    expect(isPreciousMetalFxPair('XAUUS')).toBe(false);
  });

  it('maps to Twelve Data slash symbol', () => {
    expect(toTwelveDataFxSymbol('XAUUSD')).toBe('XAU/USD');
    expect(toTwelveDataFxSymbol('EURUSD')).toBe('EUR/USD');
  });
});
