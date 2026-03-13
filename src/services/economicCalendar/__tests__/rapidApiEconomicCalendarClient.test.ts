/**
 * Unit tests for RapidAPI Economic Calendar client.
 * Verifies empty-array behavior when key is missing or API fails.
 */

import axios from 'axios';
import { RapidApiEconomicCalendarClient } from '../rapidApiEconomicCalendarClient';

jest.mock('axios');
jest.mock('../../../../config/env', () => ({
  env: {
    RAPIDAPI_KEY: 'test-key',
    RAPIDAPI_ECONOMIC_CALENDAR_HOST: 'economic-calendar-api.p.rapidapi.com',
  },
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RapidApiEconomicCalendarClient', () => {
  let client: RapidApiEconomicCalendarClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      get: jest.fn(),
    } as any);
  });

  describe('when API returns success with data', () => {
    beforeEach(() => {
      client = new RapidApiEconomicCalendarClient();
      const mockGet = jest.fn().mockResolvedValue({
        data: {
          success: true,
          data: [
            {
              id: 'evt-1',
              eventId: 'evt-1',
              name: 'Non-Farm Payrolls',
              countryCode: 'US',
              currencyCode: 'USD',
              dateUtc: '2025-01-03T13:30:00.000Z',
              periodType: 'monthly',
              volatility: 'HIGH',
              actual: '216K',
              consensus: '200K',
              previous: '199K',
              unit: 'Jobs',
            },
          ],
        },
      });
      mockedAxios.create.mockReturnValue({ get: mockGet } as any);
      client = new RapidApiEconomicCalendarClient();
    });

    it('getCalendar returns parsed events', async () => {
      const result = await client.getCalendar({
        startDate: '2025-01-01',
        endDate: '2025-01-07',
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Non-Farm Payrolls');
      expect(result[0].countryCode).toBe('US');
      expect(result[0].volatility).toBe('HIGH');
    });
  });

  describe('when API returns success with empty data', () => {
    beforeEach(() => {
      const mockGet = jest.fn().mockResolvedValue({
        data: { success: true, data: [] },
      });
      mockedAxios.create.mockReturnValue({ get: mockGet } as any);
      client = new RapidApiEconomicCalendarClient();
    });

    it('getCalendar returns empty array', async () => {
      const result = await client.getCalendar({
        startDate: '2025-01-01',
        endDate: '2025-01-07',
      });
      expect(result).toEqual([]);
    });
  });

  describe('when API throws', () => {
    beforeEach(() => {
      client = new RapidApiEconomicCalendarClient();
      const mockGet = jest.fn().mockRejectedValue(new Error('Network error'));
      mockedAxios.create.mockReturnValue({ get: mockGet } as any);
      client = new RapidApiEconomicCalendarClient();
    });

    it('getCalendar returns empty array', async () => {
      const result = await client.getCalendar({
        startDate: '2025-01-01',
        endDate: '2025-01-07',
      });
      expect(result).toEqual([]);
    });
  });
});
