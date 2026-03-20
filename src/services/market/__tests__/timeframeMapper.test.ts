import { mapTimeframeHint, getDefaultTimeframe } from '../timeframeMapper';

describe('timeframeMapper', () => {
  describe('mapTimeframeHint', () => {
    it('should map scalping terms to M5', () => {
      expect(mapTimeframeHint('scalp')).toEqual({ unit: 'M', size: 5, label: '5 Minutes' });
      expect(mapTimeframeHint('scalping')).toEqual({ unit: 'M', size: 5, label: '5 Minutes' });
      expect(mapTimeframeHint('scalper')).toEqual({ unit: 'M', size: 5, label: '5 Minutes' });
    });

    it('should map intraday terms to H1', () => {
      expect(mapTimeframeHint('intraday')).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
      expect(mapTimeframeHint('day trading')).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
      expect(mapTimeframeHint('day trade')).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
    });

    it('should map swing terms to H4', () => {
      expect(mapTimeframeHint('swing')).toEqual({ unit: 'H', size: 4, label: '4 Hours' });
      expect(mapTimeframeHint('swing trading')).toEqual({ unit: 'H', size: 4, label: '4 Hours' });
      expect(mapTimeframeHint('medium term')).toEqual({ unit: 'H', size: 4, label: '4 Hours' });
    });

    it('should map long-term terms to D1', () => {
      expect(mapTimeframeHint('long term')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
      expect(mapTimeframeHint('position trading')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
      expect(mapTimeframeHint('investment')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
    });

    it('should parse explicit timeframe strings', () => {
      expect(mapTimeframeHint('1H')).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
      expect(mapTimeframeHint('4H')).toEqual({ unit: 'H', size: 4, label: '4 Hours' });
      expect(mapTimeframeHint('D1')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
      expect(mapTimeframeHint('M15')).toEqual({ unit: 'M', size: 15, label: '15 Minutes' });
      expect(mapTimeframeHint('W1')).toEqual({ unit: 'W', size: 1, label: 'Weekly' });
      expect(mapTimeframeHint('5min')).toEqual({ unit: 'M', size: 5, label: '5 Minutes' });
      expect(mapTimeframeHint('30 minutes')).toEqual({ unit: 'M', size: 30, label: '30 Minutes' });
    });

    it('should map daily/weekly words used by price action ladder', () => {
      expect(mapTimeframeHint('daily')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
      expect(mapTimeframeHint('day')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
      expect(mapTimeframeHint('weekly')).toEqual({ unit: 'W', size: 1, label: 'Weekly' });
      expect(mapTimeframeHint('week')).toEqual({ unit: 'W', size: 1, label: 'Weekly' });
    });

    it('should handle case insensitivity', () => {
      expect(mapTimeframeHint('1h')).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
      expect(mapTimeframeHint('d1')).toEqual({ unit: 'D', size: 1, label: 'Daily' });
      expect(mapTimeframeHint('SCALP')).toEqual({ unit: 'M', size: 5, label: '5 Minutes' });
    });

    it('should return null for unrecognized hints', () => {
      expect(mapTimeframeHint('random text')).toBeNull();
      expect(mapTimeframeHint('')).toBeNull();
      expect(mapTimeframeHint('xyz123')).toBeNull();
    });

    it('should handle null/undefined inputs', () => {
      expect(mapTimeframeHint(null as any)).toBeNull();
      expect(mapTimeframeHint(undefined as any)).toBeNull();
    });
  });

  describe('getDefaultTimeframe', () => {
    it('should return H1 for FX by default', () => {
      const tf = getDefaultTimeframe('FX');
      expect(tf).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
    });

    it('should return H4 for CRYPTO by default', () => {
      const tf = getDefaultTimeframe('CRYPTO');
      expect(tf).toEqual({ unit: 'H', size: 4, label: '4 Hours' });
    });

    it('should return H1 for EQUITY by default', () => {
      const tf = getDefaultTimeframe('EQUITY');
      expect(tf).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
    });

    it('should return H1 as fallback', () => {
      const tf = getDefaultTimeframe();
      expect(tf).toEqual({ unit: 'H', size: 1, label: '1 Hour' });
    });

    it('should use trading style if provided', () => {
      const tf = getDefaultTimeframe('FX', 'scalp');
      expect(tf).toEqual({ unit: 'M', size: 5, label: '5 Minutes' });
    });
  });
});
