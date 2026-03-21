import axios, { type AxiosInstance } from 'axios';
import type { AssetClass, MarketContextRequest, RawMarketData, Timeframe } from '../../../types/market';
import { MarketDataProvider } from '../marketDataProvider';
import { inferAssetClass } from '../assetClassInferrer';
import { mapTimeframeHint, getDefaultTimeframe } from '../timeframeMapper';
import { logger } from '../../../config/logger';
import { toTwelveDataFxSymbol } from '../preciousMetalFx';

/**
 * Twelve Data time_series API for OHLC on FX pairs including precious metals (XAU/USD, etc.).
 * @see https://twelvedata.com/docs#time-series
 */
export class TwelveDataProvider implements MarketDataProvider {
  private readonly timeoutMs = 12000;
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = 'https://api.twelvedata.com',
    httpClient?: AxiosInstance
  ) {
    if (!apiKey) {
      throw new Error('Twelve Data API key is required');
    }
    this.httpClient =
      httpClient ||
      axios.create({
        baseURL: baseUrl.replace(/\/$/, ''),
        timeout: this.timeoutMs,
      });
  }

  async getSnapshot(request: MarketContextRequest): Promise<RawMarketData> {
    if (!request.symbol) {
      throw new Error('Symbol is required for Twelve Data market data');
    }

    const symbol = request.symbol.toUpperCase();
    const assetClass = request.assetClass || inferAssetClass(symbol);

    const timeframe = request.timeframeHint
      ? (mapTimeframeHint(request.timeframeHint) ?? undefined)
      : getDefaultTimeframe(assetClass);

    const interval = mapTimeframeToTwelveDataInterval(timeframe);
    const tdSymbol = toTwelveDataFxSymbol(symbol);

    const params: Record<string, string> = {
      symbol: tdSymbol,
      interval,
      apikey: this.apiKey,
      outputsize: '100',
    };

    logger.debug('Twelve Data API request', {
      symbol,
      twelveDataSymbol: tdSymbol,
      assetClass,
      interval,
    });

    try {
      const res = await this.httpClient.get('/time_series', { params });
      const json = res.data;

      if (!Array.isArray(json?.values)) {
        const msg = json?.message || json?.error || 'No time series in Twelve Data response';
        throw new Error(`Twelve Data: ${msg}`);
      }

      const raw = parseTwelveDataTimeSeries(json, symbol, assetClass);
      logger.debug('Twelve Data API response parsed', {
        symbol,
        candlesCount: raw.candles?.length ?? 0,
      });
      return raw;
    } catch (error) {
      if ((error as any).code === 'ECONNABORTED' || (error as Error).message.includes('timeout')) {
        logger.error('Twelve Data request timeout', { symbol, timeoutMs: this.timeoutMs });
        throw new Error(`Twelve Data request timed out after ${this.timeoutMs}ms`);
      }
      logger.error('Twelve Data provider error', {
        symbol,
        error: (error as Error).message,
      });
      throw new Error(`Failed to fetch Twelve Data for ${symbol}: ${(error as Error).message}`);
    }
  }
}

/**
 * Map canonical Timeframe to Twelve Data `interval` query values.
 * Supported: 1min, 5min, 15min, 30min, 45min, 1h, 2h, 4h, 8h, 1day, 1week, 1month
 */
export function mapTimeframeToTwelveDataInterval(timeframe: Timeframe | undefined): string {
  if (!timeframe) {
    return '1h';
  }

  switch (timeframe.unit) {
    case 'M': {
      const m = timeframe.size;
      if (m <= 1) return '1min';
      if (m <= 5) return '5min';
      if (m <= 15) return '15min';
      if (m <= 30) return '30min';
      if (m <= 45) return '45min';
      if (m < 60) return '45min';
      if (m < 120) return '1h';
      if (m < 240) return '2h';
      return '4h';
    }
    case 'H': {
      const h = timeframe.size;
      if (h <= 1) return '1h';
      if (h <= 2) return '2h';
      if (h <= 4) return '4h';
      if (h <= 8) return '8h';
      return '1day';
    }
    case 'D':
      return timeframe.size <= 1 ? '1day' : '1day';
    case 'W':
      return '1week';
    case 'Mo':
      return '1month';
    default:
      return '1h';
  }
}

function parseTwelveDataTimeSeries(
  json: any,
  originalSymbol: string,
  assetClass: AssetClass
): RawMarketData {
  const values = json?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('No time series values in Twelve Data response');
  }

  const candles: NonNullable<RawMarketData['candles']> = [];

  for (const row of values) {
    const open = parseFloat(row.open ?? row['1. open'] ?? '');
    const high = parseFloat(row.high ?? row['2. high'] ?? '');
    const low = parseFloat(row.low ?? row['3. low'] ?? '');
    const close = parseFloat(row.close ?? row['4. close'] ?? '');
    const dt = row.datetime as string | undefined;
    if (!dt || Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) {
      continue;
    }

    const normalized = dt.includes('T') ? dt : dt.replace(' ', 'T');
    const ts = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    if (Number.isNaN(ts)) continue;

    const vol = row.volume != null ? parseFloat(String(row.volume)) : undefined;
    candles.push({
      timestamp: ts,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(vol) ? vol : undefined,
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);

  const latest = candles[candles.length - 1];
  const m = originalSymbol.match(/^([A-Z]{3})([A-Z]{3})$/i);

  return {
    symbol: originalSymbol.toUpperCase(),
    assetClass,
    candles,
    lastPrice: latest?.close,
    timestamp: latest?.timestamp,
    provider: 'twelve_data',
    base: m ? m[1].toUpperCase() : undefined,
    quote: m ? m[2].toUpperCase() : undefined,
  };
}
