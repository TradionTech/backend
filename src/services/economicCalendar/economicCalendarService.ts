import { Op } from 'sequelize';
import { EconomicEvent } from '../../db/models/EconomicEvent';
import { rapidApiEconomicCalendarClient } from './rapidApiEconomicCalendarClient';
import type {
  EconomicCalendarContextForLLM,
  EconomicCalendarEventForLLM,
  EconomicCalendarEventRaw,
} from './economicCalendarTypes';
import { logger } from '../../config/logger';

function toEventForLLM(row: EconomicEvent): EconomicCalendarEventForLLM {
  return {
    id: row.eventId,
    dateUtc: row.dateUtc instanceof Date ? row.dateUtc.toISOString() : String(row.dateUtc),
    name: row.name,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    volatility: row.volatility as EconomicCalendarEventForLLM['volatility'],
    actual: row.actual,
    consensus: row.consensus,
    previous: row.previousValue,
    unit: row.unit,
    periodType: row.periodType ?? undefined,
  };
}

function mapRawToAttributes(raw: EconomicCalendarEventRaw): Record<string, unknown> {
  return {
    eventId: raw.eventId || raw.id,
    name: raw.name,
    countryCode: raw.countryCode,
    currencyCode: raw.currencyCode,
    dateUtc: raw.dateUtc ? new Date(raw.dateUtc) : new Date(),
    periodType: raw.periodType ?? null,
    volatility: raw.volatility ?? 'NONE',
    actual: raw.actual ?? null,
    revised: raw.revised ?? null,
    consensus: raw.consensus ?? null,
    previousValue: raw.previous ?? null,
    unit: raw.unit ?? null,
    categoryId: raw.categoryId ?? null,
    isBetterThanExpected: raw.isBetterThanExpected ?? null,
    raw: raw as unknown as object,
    lastUpdated: raw.lastUpdated ?? null,
  };
}

/**
 * Sync economic calendar from RapidAPI into the database.
 * Upserts events by eventId.
 */
export async function syncCalendar(options: {
  startDate: string;
  endDate: string;
  countryCode?: string;
}): Promise<number> {
  const events = await rapidApiEconomicCalendarClient.getCalendar({
    startDate: options.startDate,
    endDate: options.endDate,
    countryCode: options.countryCode,
    limit: 500,
  });

  if (events.length === 0) {
    logger.debug('Economic calendar sync: no events returned');
    return 0;
  }

  let upserted = 0;
  for (const raw of events) {
    const eventId = raw.eventId || raw.id;
    if (!eventId) continue;

    const attrs = mapRawToAttributes(raw);
    const [row, created] = await EconomicEvent.findOrCreate({
      where: { eventId },
      defaults: attrs as Record<string, unknown>,
    });
    if (!created) {
      await row.update(attrs as Partial<EconomicEvent>);
    }
    upserted++;
  }

  logger.info('Economic calendar sync completed', {
    startDate: options.startDate,
    endDate: options.endDate,
    eventsReceived: events.length,
    upserted,
  });
  return upserted;
}

/**
 * Get events from DB for chat context. Returns empty context if no data.
 */
export async function getEventsForChat(options: {
  from: Date;
  to: Date;
  countryCodes?: string[];
  limit?: number;
}): Promise<EconomicCalendarContextForLLM> {
  const limit = options.limit ?? 50;

  const where: Record<string, unknown> = {
    dateUtc: {
      [Op.gte]: options.from,
      [Op.lte]: options.to,
    },
  };
  if (options.countryCodes?.length) {
    where.countryCode = { [Op.in]: options.countryCodes };
  }

  const rows = await EconomicEvent.findAll({
    where,
    order: [['dateUtc', 'ASC']],
    limit,
  });

  const events: EconomicCalendarEventForLLM[] = rows.map(toEventForLLM);

  return {
    window: {
      from: options.from.toISOString().slice(0, 10),
      to: options.to.toISOString().slice(0, 10),
    },
    events,
    dataQuality: {
      isFresh: rows.length > 0,
      source: 'rapidapi_economic_calendar',
    },
  };
}

export const economicCalendarService = {
  syncCalendar,
  getEventsForChat,
};
