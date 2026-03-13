import { env } from '../../config/env';
import type { MarketContextResult } from '../../types/market';
import type { SentimentContextForLLM } from '../sentiment/sentimentTypes';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory cache for market and sentiment context with TTL.
 * Reduces repeated API calls when the same symbol/timeframe is requested within the TTL window.
 */
export class ContextCache {
  private marketCache = new Map<string, CacheEntry<MarketContextResult>>();
  private sentimentCache = new Map<string, CacheEntry<SentimentContextForLLM>>();
  private readonly ttlMs: number;
  private readonly enabled: boolean;

  constructor() {
    this.ttlMs = (env.CONTEXT_CACHE_TTL_SECONDS ?? 90) * 1000;
    this.enabled = env.CONTEXT_CACHE_ENABLED !== false;
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Round window minutes to a bucket to avoid cache fragmentation.
   * Buckets: 60 (1h), 240 (4h), 1440 (1d), 10080 (7d), 43200 (30d).
   */
  static bucketWindowMinutes(windowMinutes: number): number {
    if (windowMinutes <= 60) return 60;
    if (windowMinutes <= 240) return 240;
    if (windowMinutes <= 1440) return 1440;
    if (windowMinutes <= 10080) return 10080;
    return 43200;
  }

  private marketKey(symbol: string, timeframeHint?: string | null): string {
    const tf = (timeframeHint ?? 'default').toString().trim() || 'default';
    return `market:${symbol}:${tf}`;
  }

  private sentimentKey(symbol: string, windowMinutes: number): string {
    const bucket = ContextCache.bucketWindowMinutes(windowMinutes);
    return `sentiment:${symbol}:${bucket}`;
  }

  getMarket(symbol: string, timeframeHint?: string | null): MarketContextResult | undefined {
    if (!this.enabled || !symbol) return undefined;
    const key = this.marketKey(symbol, timeframeHint);
    const entry = this.marketCache.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.marketCache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  setMarket(
    symbol: string,
    timeframeHint: string | null | undefined,
    value: MarketContextResult
  ): void {
    if (!this.enabled || !symbol) return;
    const key = this.marketKey(symbol, timeframeHint);
    this.marketCache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  getSentiment(symbol: string, windowMinutes: number): SentimentContextForLLM | undefined {
    if (!this.enabled || !symbol) return undefined;
    const key = this.sentimentKey(symbol, windowMinutes);
    const entry = this.sentimentCache.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.sentimentCache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  setSentiment(symbol: string, windowMinutes: number, value: SentimentContextForLLM): void {
    if (!this.enabled || !symbol) return;
    const key = this.sentimentKey(symbol, windowMinutes);
    this.sentimentCache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Skip cache when the user message or metadata suggests they want fresh data.
   */
  static shouldSkipCache(message: string, _metadata?: Record<string, unknown>): boolean {
    const normalized = message.toLowerCase();
    const refreshKeywords = [
      'latest',
      'refresh',
      'current',
      'now',
      'realtime',
      'real-time',
      'live',
    ];
    return refreshKeywords.some((k) => normalized.includes(k));
  }
}

export const contextCache = new ContextCache();
