/**
 * Types for RapidAPI Economic Calendar API and chat context.
 */

export type VolatilityLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface VolatilityBreakdown {
  overall?: string;
  previous?: string;
}

export interface EconomicCalendarEventRaw {
  id: string;
  eventId: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  dateUtc: string;
  periodDateUtc: string;
  periodType: string;
  volatility: VolatilityLevel;
  volatilityBreakdown?: VolatilityBreakdown;
  actual: string | null;
  revised: string | null;
  consensus: string | null;
  previous: string | null;
  unit: string | null;
  categoryId: string | null;
  ratioDeviation?: number | null;
  isBetterThanExpected?: boolean | null;
  isScoreTrackable?: boolean;
  isAllDay?: boolean;
  isTentative?: boolean;
  isPreliminary?: boolean;
  isReport?: boolean;
  isSpeech?: boolean;
  hasHistorical?: boolean;
  lastUpdated?: string | null;
  dateRange?: { start?: string; end?: string };
}

export interface EconomicCalendarApiResponse {
  success: boolean;
  message?: string;
  data: EconomicCalendarEventRaw[];
  lastUpdated?: string;
  totalEvents?: number;
  timezone?: string;
  volatilityBreakdown?: Record<VolatilityLevel, number>;
  dateRange?: { start: string; end: string };
  maxLimit?: number;
}

export interface EconomicCalendarEventForLLM {
  id: string;
  dateUtc: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  volatility: VolatilityLevel;
  actual: string | null;
  consensus: string | null;
  previous: string | null;
  unit: string | null;
  periodType?: string;
}

export interface EconomicCalendarContextForLLM {
  window: { from: string; to: string };
  events: EconomicCalendarEventForLLM[];
  dataQuality?: { isFresh: boolean; source: string };
}
