import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import type { EconomicCalendarApiResponse } from './economicCalendarTypes';
import { logger } from '../../config/logger';

/**
 * RapidAPI Economic Calendar client.
 * GET /calendar with startDate, endDate, and optional filters.
 */
export class RapidApiEconomicCalendarClient {
  private readonly client: AxiosInstance;
  private readonly enabled: boolean;

  constructor() {
    this.enabled = !!env.RAPIDAPI_KEY && !!env.RAPIDAPI_ECONOMIC_CALENDAR_HOST;
    this.client = axios.create({
      baseURL: `https://${env.RAPIDAPI_ECONOMIC_CALENDAR_HOST}`,
      timeout: 30000,
      headers: {
        'X-RapidAPI-Key': env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': env.RAPIDAPI_ECONOMIC_CALENDAR_HOST,
      },
    });
  }

  /**
   * Get economic calendar events for a date range.
   * Returns empty array if key is missing or API fails.
   */
  async getCalendar(params: {
    startDate: string;
    endDate: string;
    countryCode?: string;
    volatility?: string;
    limit?: number;
    timezone?: string;
  }): Promise<EconomicCalendarApiResponse['data']> {
    if (!this.enabled) {
      logger.debug('RapidAPI Economic Calendar: key or host not configured');
      return [];
    }

    try {
      const { data } = await this.client.get<EconomicCalendarApiResponse>('/calendar', {
        params: {
          startDate: params.startDate,
          endDate: params.endDate,
          ...(params.countryCode && { countryCode: params.countryCode }),
          ...(params.volatility && { volatility: params.volatility }),
          ...(params.limit && { limit: params.limit }),
          ...(params.timezone && { timezone: params.timezone }),
        },
      });

      if (!data?.success || !Array.isArray(data.data)) {
        logger.warn('RapidAPI Economic Calendar: unexpected response', {
          success: data?.success,
          hasData: Array.isArray(data?.data),
        });
        return [];
      }

      return data.data;
    } catch (error: unknown) {
      const err = error as { response?: { status?: number }; message?: string };
      logger.warn('RapidAPI Economic Calendar request failed', {
        status: err.response?.status,
        message: err.message,
      });
      return [];
    }
  }
}

export const rapidApiEconomicCalendarClient = new RapidApiEconomicCalendarClient();
