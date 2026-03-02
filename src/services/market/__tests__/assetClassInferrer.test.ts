import { inferAssetClass } from '../assetClassInferrer';

describe('assetClassInferrer', () => {
  describe('inferAssetClass', () => {
    it('should identify FX pairs', () => {
      expect(inferAssetClass('EURUSD')).toBe('FX');
      expect(inferAssetClass('GBPUSD')).toBe('FX');
      expect(inferAssetClass('USDJPY')).toBe('FX');
      expect(inferAssetClass('EURGBP')).toBe('FX');
      expect(inferAssetClass('EUR/USD')).toBe('FX');
      expect(inferAssetClass('EUR-USD')).toBe('FX');
    });

    it('should identify crypto tickers', () => {
      expect(inferAssetClass('BTC')).toBe('CRYPTO');
      expect(inferAssetClass('ETH')).toBe('CRYPTO');
      expect(inferAssetClass('BNB')).toBe('CRYPTO');
      expect(inferAssetClass('SOL')).toBe('CRYPTO');
      expect(inferAssetClass('USDT')).toBe('CRYPTO');
      expect(inferAssetClass('BTCUSDT')).toBe('CRYPTO');
      expect(inferAssetClass('ETHUSD')).toBe('CRYPTO');
    });

    it('should identify index symbols', () => {
      expect(inferAssetClass('SPX')).toBe('INDEX');
      expect(inferAssetClass('SPY')).toBe('INDEX');
      expect(inferAssetClass('DJI')).toBe('INDEX');
      expect(inferAssetClass('NDX')).toBe('INDEX');
      expect(inferAssetClass('QQQ')).toBe('INDEX');
      expect(inferAssetClass('VIX')).toBe('INDEX');
    });

    it('should identify equity-like tickers', () => {
      expect(inferAssetClass('AAPL')).toBe('EQUITY');
      expect(inferAssetClass('MSFT')).toBe('EQUITY');
      expect(inferAssetClass('TSLA')).toBe('EQUITY');
      expect(inferAssetClass('GOOGL')).toBe('EQUITY');
    });

    it('should use metadata asset class if provided', () => {
      expect(inferAssetClass('UNKNOWN', { assetClass: 'FX' })).toBe('FX');
      expect(inferAssetClass('UNKNOWN', { assetClass: 'CRYPTO' })).toBe('CRYPTO');
    });

    it('should ignore invalid metadata asset class', () => {
      expect(inferAssetClass('EURUSD', { assetClass: 'INVALID' })).toBe('FX');
    });

    it('should handle case insensitivity', () => {
      expect(inferAssetClass('eurusd')).toBe('FX');
      expect(inferAssetClass('btc')).toBe('CRYPTO');
      expect(inferAssetClass('aapl')).toBe('EQUITY');
    });

    it('should return OTHER for unrecognized symbols', () => {
      expect(inferAssetClass('XYZ123ABC')).toBe('OTHER');
      expect(inferAssetClass('')).toBe('OTHER');
    });

    it('should handle null/undefined inputs', () => {
      expect(inferAssetClass(null as any)).toBe('OTHER');
      expect(inferAssetClass(undefined as any)).toBe('OTHER');
    });
  });
});
