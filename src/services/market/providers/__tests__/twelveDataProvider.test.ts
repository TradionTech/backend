import { TwelveDataProvider, mapTimeframeToTwelveDataInterval } from '../twelveDataProvider';
import type { MarketContextRequest } from '../../../../types/market';
import axios, { type AxiosInstance } from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TwelveDataProvider', () => {
  let provider: TwelveDataProvider;
  let mockAxiosInstance: jest.Mocked<AxiosInstance>;

  beforeEach(() => {
    mockAxiosInstance = {
      get: jest.fn(),
    } as any;

    mockedAxios.create = jest.fn(() => mockAxiosInstance) as any;

    provider = new TwelveDataProvider('test-key', 'https://api.twelvedata.com', mockAxiosInstance);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and parses time_series for XAUUSD', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        status: 'ok',
        values: [
          {
            datetime: '2024-01-15 14:00:00',
            open: '2040.1',
            high: '2045.2',
            low: '2038.0',
            close: '2042.5',
          },
          {
            datetime: '2024-01-15 15:00:00',
            open: '2042.5',
            high: '2050.0',
            low: '2041.0',
            close: '2048.3',
          },
        ],
      },
    });

    const request: MarketContextRequest = {
      symbol: 'XAUUSD',
      assetClass: 'FX',
    };

    const result = await provider.getSnapshot(request);

    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/time_series', {
      params: expect.objectContaining({
        symbol: 'XAU/USD',
        interval: '1h',
        apikey: 'test-key',
        outputsize: '100',
      }),
    });

    expect(result.symbol).toBe('XAUUSD');
    expect(result.provider).toBe('twelve_data');
    expect(result.candles).toHaveLength(2);
    expect(result.candles![0].close).toBe(2042.5);
    expect(result.candles![1].close).toBe(2048.3);
    expect(result.lastPrice).toBe(2048.3);
    expect(result.base).toBe('XAU');
    expect(result.quote).toBe('USD');
  });

  it('throws when response has no values array', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        status: 'error',
        message: 'Invalid symbol',
      },
    });

    await expect(
      provider.getSnapshot({ symbol: 'XAUUSD', assetClass: 'FX' })
    ).rejects.toThrow(/Twelve Data/);
  });
});

describe('mapTimeframeToTwelveDataInterval', () => {
  it('maps common timeframes', () => {
    expect(mapTimeframeToTwelveDataInterval(undefined)).toBe('1h');
    expect(mapTimeframeToTwelveDataInterval({ unit: 'H', size: 1, label: '1 Hour' })).toBe('1h');
    expect(mapTimeframeToTwelveDataInterval({ unit: 'H', size: 4, label: '4 Hours' })).toBe('4h');
    expect(mapTimeframeToTwelveDataInterval({ unit: 'M', size: 5, label: '5 Minutes' })).toBe('5min');
    expect(mapTimeframeToTwelveDataInterval({ unit: 'D', size: 1, label: 'Daily' })).toBe('1day');
    expect(mapTimeframeToTwelveDataInterval({ unit: 'W', size: 1, label: 'Weekly' })).toBe('1week');
    expect(mapTimeframeToTwelveDataInterval({ unit: 'Mo', size: 1, label: 'Monthly' })).toBe('1month');
  });
});
