import { economicCalendarService } from '../services/economicCalendar/economicCalendarService';
import { logger } from '../config/logger';

/**
 * Sync economic calendar from RapidAPI into the database.
 * Fetches next 14 days; run once or twice daily (e.g. 06:00 and 18:00).
 */
export async function syncEconomicCalendar(): Promise<void> {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  try {
    const count = await economicCalendarService.syncCalendar({ startDate: from, endDate: to });
    logger.info('syncEconomicCalendar finished', { from, to, eventsSynced: count });
  } catch (error) {
    logger.error('syncEconomicCalendar failed', {
      from,
      to,
      error: (error as Error).message,
    });
    // Do not rethrow so scheduler continues
  }
}
