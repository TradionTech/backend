import { resolveMarketSymbol } from '../symbolResolver';

describe('symbolResolver', () => {
  it('does not map XAUUSD (gold) to XAFUSD via ISO fuzzy match', () => {
    const result = resolveMarketSymbol({ symbol: 'XAUUSD', assetClass: 'FX' });
    expect(result.symbol).toBe('XAUUSD');
    expect(result.assetClass).toBe('FX');
    expect(result.issues?.some((i) => i.includes('XAF'))).toBeFalsy();
  });

  it('autocorrects FX leg typo GPBUSD -> GBPUSD', () => {
    const result = resolveMarketSymbol({ symbol: 'GPBUSD', assetClass: 'FX' });
    expect(result.symbol).toBe('GBPUSD');
    expect(result.assetClass).toBe('FX');
    expect(result.issues?.some((i) => i.includes('symbol_autocorrected'))).toBe(true);
  });

  it('autocorrects crypto typo BCTUSD -> BTCUSD', () => {
    const result = resolveMarketSymbol({ symbol: 'BCTUSD', assetClass: 'CRYPTO' });
    expect(result.symbol).toBe('BTCUSD');
    expect(result.assetClass).toBe('CRYPTO');
  });

  it('autocorrects equity typo APL -> AAPL', () => {
    const result = resolveMarketSymbol({ symbol: 'APL', assetClass: 'EQUITY' });
    expect(result.symbol).toBe('AAPL');
    expect(result.assetClass).toBe('EQUITY');
  });

  it('maps company name from query to ticker', () => {
    const result = resolveMarketSymbol({ rawQuery: 'What is the current price of Apple today?' });
    expect(result.symbol).toBe('AAPL');
    expect(result.assetClass).toBe('EQUITY');
    expect(result.issues?.some((i) => i.startsWith('symbol_inferred_from_company_name'))).toBe(true);
  });

  it('maps Berkshire Hathaway company name to BRK.B', () => {
    const result = resolveMarketSymbol({ rawQuery: 'How is Berkshire Hathaway doing today?' });
    expect(result.symbol).toBe('BRK.B');
    expect(result.assetClass).toBe('EQUITY');
  });

  it('normalizes BRKB variant to BRK.B', () => {
    const result = resolveMarketSymbol({ symbol: 'BRKB', assetClass: 'EQUITY' });
    expect(result.symbol).toBe('BRK.B');
  });
});

