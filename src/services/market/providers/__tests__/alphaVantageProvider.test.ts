import { AlphaVantageProvider } from '../alphaVantageProvider';
import {
  mapRequestToAlphaParams,
  parseTimeSeriesResponse,
  detectAlphaVantageError,
} from '../alphaVantageQuirks';
import type { MarketContextRequest, Timeframe } from '../../../../types/market';
import axios, { type AxiosInstance } from 'axios';
import { env } from '../../../../config/env';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AlphaVantageProvider', () => {
  let provider: AlphaVantageProvider;
  let mockAxiosInstance: jest.Mocked<AxiosInstance>;
  let prevEnrichQuotes: boolean;

  beforeEach(() => {
    prevEnrichQuotes = env.ALPHAVANTAGE_ENRICH_QUOTES;
    env.ALPHAVANTAGE_ENRICH_QUOTES = false;

    // Create mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
    } as any;

    // Mock axios.create to return our mock instance
    mockedAxios.create = jest.fn(() => mockAxiosInstance) as any;

    provider = new AlphaVantageProvider('test-api-key', 'https://www.alphavantage.co/query', mockAxiosInstance);
  });

  afterEach(() => {
    env.ALPHAVANTAGE_ENRICH_QUOTES = prevEnrichQuotes;
    jest.clearAllMocks();
  });

  describe('getSnapshot', () => {
    it('should fetch and parse intraday equity data', async () => {
      const mockResponse = {
        data: {
          'Meta Data': {
            '1. Information': 'Intraday (5min) open, high, low, close prices and volume',
            '2. Symbol': 'IBM',
            '3. Last Refreshed': '2024-01-15 16:00:00',
            '4. Interval': '5min',
            '5. Output Size': 'Compact',
            '6. Time Zone': 'US/Eastern',
          },
          'Time Series (5min)': {
            '2024-01-15 16:00:00': {
              '1. open': '150.0000',
              '2. high': '151.0000',
              '3. low': '149.0000',
              '4. close': '150.5000',
              '5. volume': '1000000',
            },
            '2024-01-15 15:55:00': {
              '1. open': '149.5000',
              '2. high': '150.5000',
              '3. low': '149.0000',
              '4. close': '150.0000',
              '5. volume': '950000',
            },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const request: MarketContextRequest = {
        symbol: 'IBM',
        assetClass: 'EQUITY',
        timeframeHint: '5min',
      };

      const result = await provider.getSnapshot(request);

      expect(result.symbol).toBe('IBM');
      expect(result.assetClass).toBe('EQUITY');
      expect(result.provider).toBe('alpha_vantage');
      expect(result.candles).toBeDefined();
      expect(result.candles?.length).toBe(2);
      expect(result.candles?.[0].open).toBe(149.5);
      expect(result.candles?.[0].close).toBe(150);
      expect(result.candles?.[1].open).toBe(150);
      expect(result.candles?.[1].close).toBe(150.5);
      expect(result.lastPrice).toBe(150.5);
      expect(result.timestamp).toBeDefined();

      // Verify API call
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('', {
        params: expect.objectContaining({
          apikey: 'test-api-key',
          function: 'TIME_SERIES_INTRADAY',
          symbol: 'IBM',
          interval: '5min',
          datatype: 'json',
          outputsize: 'compact',
        }),
      });
    });

    it('should fetch and parse daily FX data', async () => {
      const mockResponse = {
        data: {
          'Meta Data': {
            '1. Information': 'Forex Daily Prices (open, high, low, close)',
            '2. From Symbol': 'EUR',
            '3. To Symbol': 'USD',
            '4. Last Refreshed': '2024-01-15',
            '5. Output Size': 'Compact',
            '6. Time Zone': 'UTC',
          },
          'Time Series FX (Daily)': {
            '2024-01-15': {
              '1. open': '1.1000',
              '2. high': '1.1050',
              '3. low': '1.0950',
              '4. close': '1.1020',
            },
            '2024-01-14': {
              '1. open': '1.0980',
              '2. high': '1.1020',
              '3. low': '1.0970',
              '4. close': '1.1000',
            },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        timeframeHint: 'daily',
      };

      const result = await provider.getSnapshot(request);

      expect(result.symbol).toBe('EURUSD');
      expect(result.assetClass).toBe('FX');
      expect(result.provider).toBe('alpha_vantage');
      expect(result.base).toBe('EUR');
      expect(result.quote).toBe('USD');
      expect(result.candles).toBeDefined();
      expect(result.candles?.length).toBe(2);
      expect(result.lastPrice).toBe(1.1020);

      // Verify API call with FX parameters
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('', {
        params: expect.objectContaining({
          apikey: 'test-api-key',
          function: 'FX_DAILY',
          from_symbol: 'EUR',
          to_symbol: 'USD',
          datatype: 'json',
          outputsize: 'compact',
        }),
      });
    });

    it('should fetch FX intraday for H1 using FX_INTRADAY', async () => {
      const mockResponse = {
        data: {
          'Meta Data': {
            '1. Information': 'Forex Intraday (60min)',
            '2. From Symbol': 'EUR',
            '3. To Symbol': 'USD',
            '4. Last Refreshed': '2024-01-15 16:00:00',
            '5. Interval': '60min',
          },
          'Time Series FX (60min)': {
            '2024-01-15 15:00:00': {
              '1. open': '1.1000',
              '2. high': '1.1050',
              '3. low': '1.0950',
              '4. close': '1.1010',
            },
            '2024-01-15 16:00:00': {
              '1. open': '1.1010',
              '2. high': '1.1060',
              '3. low': '1.0960',
              '4. close': '1.1020',
            },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
        timeframeHint: '1H',
      };

      const result = await provider.getSnapshot(request);

      expect(result.issues).toBeUndefined();
      expect(result.candles?.length).toBe(2);
      expect(result.lastPrice).toBe(1.102);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('', {
        params: expect.objectContaining({
          function: 'FX_INTRADAY',
          from_symbol: 'EUR',
          to_symbol: 'USD',
          interval: '60min',
        }),
      });
    });

    it('should handle error response with Error Message', async () => {
      const mockResponse = {
        data: {
          'Error Message': 'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for TIME_SERIES_INTRADAY.',
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const request: MarketContextRequest = {
        symbol: 'INVALID',
        assetClass: 'EQUITY',
      };

      await expect(provider.getSnapshot(request)).rejects.toThrow('Alpha Vantage API error');
    });

    it('should handle rate limit response with Note', async () => {
      const mockResponse = {
        data: {
          Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 500 calls per day. Please visit https://www.alphavantage.co/premium/ if you would like to target a higher API call frequency.',
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const request: MarketContextRequest = {
        symbol: 'IBM',
        assetClass: 'EQUITY',
      };

      await expect(provider.getSnapshot(request)).rejects.toThrow('Alpha Vantage rate limit');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network Error');
      (networkError as any).code = 'ENOTFOUND';
      mockAxiosInstance.get.mockRejectedValue(networkError);

      const request: MarketContextRequest = {
        symbol: 'IBM',
        assetClass: 'EQUITY',
      };

      await expect(provider.getSnapshot(request)).rejects.toThrow('Alpha Vantage network error');
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout of 10000ms exceeded');
      (timeoutError as any).code = 'ECONNABORTED';
      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      const request: MarketContextRequest = {
        symbol: 'IBM',
        assetClass: 'EQUITY',
      };

      await expect(provider.getSnapshot(request)).rejects.toThrow('Alpha Vantage request timed out');
    });

    it('should throw error when symbol is missing', async () => {
      const request: MarketContextRequest = {
        assetClass: 'EQUITY',
      };

      await expect(provider.getSnapshot(request)).rejects.toThrow('Symbol is required');
    });

    it('should throw error when API key is missing', () => {
      expect(() => {
        new AlphaVantageProvider('');
      }).toThrow('Alpha Vantage API key is required');
    });
  });
});

describe('alphaVantageQuirks', () => {
  describe('mapRequestToAlphaParams', () => {
    it('should map equity intraday request correctly', () => {
      const request: MarketContextRequest = {
        symbol: 'IBM',
        assetClass: 'EQUITY',
      };
      const timeframe: Timeframe = { unit: 'M', size: 5, label: '5 Minutes' };

      const params = mapRequestToAlphaParams(request, timeframe, 'EQUITY');

      expect(params.func).toBe('TIME_SERIES_INTRADAY');
      expect(params.symbolParam.symbol).toBe('IBM');
      expect(params.interval).toBe('5min');
    });

    it('should map equity daily request correctly', () => {
      const request: MarketContextRequest = {
        symbol: 'IBM',
        assetClass: 'EQUITY',
      };
      const timeframe: Timeframe = { unit: 'D', size: 1, label: 'Daily' };

      const params = mapRequestToAlphaParams(request, timeframe, 'EQUITY');

      expect(params.func).toBe('TIME_SERIES_DAILY');
      expect(params.symbolParam.symbol).toBe('IBM');
      expect(params.interval).toBeUndefined();
    });

    it('should map FX daily request correctly', () => {
      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };
      const timeframe: Timeframe = { unit: 'D', size: 1, label: 'Daily' };

      const params = mapRequestToAlphaParams(request, timeframe, 'FX');

      expect(params.func).toBe('FX_DAILY');
      expect(params.symbolParam.from_symbol).toBe('EUR');
      expect(params.symbolParam.to_symbol).toBe('USD');
    });

    it('should map FX intraday to FX_INTRADAY', () => {
      const request: MarketContextRequest = {
        symbol: 'EURUSD',
        assetClass: 'FX',
      };
      const timeframe: Timeframe = { unit: 'H', size: 1, label: '1 Hour' };

      const params = mapRequestToAlphaParams(request, timeframe, 'FX');

      expect(params.func).toBe('FX_INTRADAY');
      expect(params.interval).toBe('60min');
      expect(params.symbolParam.from_symbol).toBe('EUR');
      expect(params.symbolParam.to_symbol).toBe('USD');
    });

    it('should map crypto daily request correctly', () => {
      const request: MarketContextRequest = {
        symbol: 'BTC',
        assetClass: 'CRYPTO',
      };
      const timeframe: Timeframe = { unit: 'D', size: 1, label: 'Daily' };

      const params = mapRequestToAlphaParams(request, timeframe, 'CRYPTO');

      expect(params.func).toBe('DIGITAL_CURRENCY_DAILY');
      expect(params.symbolParam.symbol).toBe('BTC');
      expect(params.symbolParam.market).toBe('USD');
    });

    it('should parse crypto symbol with market separator', () => {
      const request: MarketContextRequest = {
        symbol: 'BTC/USD',
        assetClass: 'CRYPTO',
      };
      const timeframe: Timeframe = { unit: 'D', size: 1, label: 'Daily' };

      const params = mapRequestToAlphaParams(request, timeframe, 'CRYPTO');

      expect(params.func).toBe('DIGITAL_CURRENCY_DAILY');
      expect(params.symbolParam.symbol).toBe('BTC');
      expect(params.symbolParam.market).toBe('USD');
    });

    it('should map crypto intraday to DIGITAL_CURRENCY_INTRADAY', () => {
      const request: MarketContextRequest = {
        symbol: 'BTC',
        assetClass: 'CRYPTO',
      };
      const timeframe: Timeframe = { unit: 'M', size: 15, label: '15 Minutes' };

      const params = mapRequestToAlphaParams(request, timeframe, 'CRYPTO');

      expect(params.func).toBe('DIGITAL_CURRENCY_INTRADAY');
      expect(params.interval).toBe('15min');
      expect(params.symbolParam.symbol).toBe('BTC');
      expect(params.symbolParam.market).toBe('USD');
    });
  });

  describe('parseTimeSeriesResponse', () => {
    it('should parse intraday equity response', () => {
      const json = {
        'Time Series (5min)': {
          '2024-01-15 16:00:00': {
            '1. open': '150.0000',
            '2. high': '151.0000',
            '3. low': '149.0000',
            '4. close': '150.5000',
            '5. volume': '1000000',
          },
          '2024-01-15 15:55:00': {
            '1. open': '149.5000',
            '2. high': '150.5000',
            '3. low': '149.0000',
            '4. close': '150.0000',
            '5. volume': '950000',
          },
        },
      };

      const params = {
        func: 'TIME_SERIES_INTRADAY',
        symbolParam: { symbol: 'IBM' },
        interval: '5min',
      };

      const result = parseTimeSeriesResponse(json, params, 'IBM', 'EQUITY');

      expect(result.symbol).toBe('IBM');
      expect(result.assetClass).toBe('EQUITY');
      expect(result.candles?.length).toBe(2);
      const c = result.candles!;
      expect(c[0].timestamp).toBeLessThan(c[1].timestamp);
      expect(result.lastPrice).toBe(150.5);
    });

    it('should parse FX daily response', () => {
      const json = {
        'Time Series FX (Daily)': {
          '2024-01-15': {
            '1. open': '1.1000',
            '2. high': '1.1050',
            '3. low': '1.0950',
            '4. close': '1.1020',
          },
        },
      };

      const params = {
        func: 'FX_DAILY',
        symbolParam: { from_symbol: 'EUR', to_symbol: 'USD' },
      };

      const result = parseTimeSeriesResponse(json, params, 'EURUSD', 'FX');

      expect(result.symbol).toBe('EURUSD');
      expect(result.assetClass).toBe('FX');
      expect(result.base).toBe('EUR');
      expect(result.quote).toBe('USD');
      expect(result.issues).toBeUndefined();
    });
  });

  describe('detectAlphaVantageError', () => {
    it('should detect Error Message', () => {
      const json = {
        'Error Message': 'Invalid API call',
      };

      const result = detectAlphaVantageError(json);

      expect(result.isError).toBe(true);
      expect(result.reason).toBe('INVALID_CALL');
      expect(result.rawMessage).toBe('Invalid API call');
    });

    it('should detect rate limit in Note', () => {
      const json = {
        Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.',
      };

      const result = detectAlphaVantageError(json);

      expect(result.isError).toBe(true);
      expect(result.reason).toBe('RATE_LIMIT');
    });

    it('should not treat informational Note as error', () => {
      const json = {
        Note: 'This is just an informational note',
      };

      const result = detectAlphaVantageError(json);

      expect(result.isError).toBe(false);
    });

    it('should return no error for valid response', () => {
      const json = {
        'Meta Data': {
          '1. Information': 'Intraday (5min) prices',
        },
        'Time Series (5min)': {},
      };

      const result = detectAlphaVantageError(json);

      expect(result.isError).toBe(false);
    });
  });
});
