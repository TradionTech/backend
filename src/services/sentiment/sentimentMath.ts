/**
 * Sentiment Math - Pure, Deterministic Functions
 * 
 * All scoring and aggregation logic is computed deterministically in the backend.
 * These functions are pure (no side effects) and testable.
 */

import type {
  RawSentimentSignal,
  NormalizedSentimentSignal,
  SentimentScoreAggregate,
  SentimentDriver,
  SentimentSnapshotConfig,
} from './sentimentTypes';

/**
 * Normalize a raw sentiment signal to -1..1 scale.
 * 
 * Formula: norm = ((raw.score - raw.scaleMin) / (raw.scaleMax - raw.scaleMin)) * 2 - 1
 * 
 * Examples:
 * - Score 50 on 0-100 scale → (50-0)/(100-0) * 2 - 1 = 0.0 (neutral)
 * - Score 75 on 0-100 scale → (75-0)/(100-0) * 2 - 1 = 0.5 (bullish)
 * - Score 25 on 0-100 scale → (25-0)/(100-0) * 2 - 1 = -0.5 (bearish)
 */
export function normalizeSignal(raw: RawSentimentSignal): NormalizedSentimentSignal {
  // Handle edge case: scale range is zero
  const scaleRange = raw.scaleMax - raw.scaleMin;
  if (scaleRange === 0) {
    // If scale is a single point, treat as neutral
    return {
      symbol: raw.symbol,
      source: raw.source,
      normalizedScore: 0,
      weight: raw.weight,
      timestamp: raw.timestamp,
      label: raw.label,
    };
  }

  // Normalize to 0..1 first, then map to -1..1
  const normalized01 = (raw.score - raw.scaleMin) / scaleRange;
  const normalizedScore = normalized01 * 2 - 1;

  // Clamp to -1..1 range (shouldn't be necessary, but safety check)
  const clampedScore = Math.max(-1, Math.min(1, normalizedScore));

  return {
    symbol: raw.symbol,
    source: raw.source,
    normalizedScore: clampedScore,
    weight: raw.weight,
    timestamp: raw.timestamp,
    label: raw.label,
  };
}

/**
 * Aggregate normalized signals into a single sentiment score.
 * 
 * Uses weighted average: score = sum(normScore * weight) / sum(weight)
 * 
 * Direction classification:
 * - If |score| < neutralThreshold → "neutral"
 * - Else if score > 0 → "bullish"
 * - Else if score < 0 → "bearish"
 * 
 * Confidence calculation:
 * - Signals factor: min(1, signals.length / minSignals)
 * - Source factor: min(1, uniqueSources / 3)
 * - Combined: (signalsFactor + sourceFactor) / 2
 */
export function aggregateSignals(
  signals: NormalizedSentimentSignal[],
  config: SentimentSnapshotConfig
): SentimentScoreAggregate | null {
  if (signals.length === 0) {
    return null;
  }

  // Weighted average
  let weightedSum = 0;
  let totalWeight = 0;
  const sources = new Set<string>();

  for (const signal of signals) {
    weightedSum += signal.normalizedScore * signal.weight;
    totalWeight += signal.weight;
    sources.add(signal.source);
  }

  if (totalWeight === 0) {
    return null;
  }

  const score = weightedSum / totalWeight;
  const clampedScore = Math.max(-1, Math.min(1, score));

  // Determine direction
  let direction: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  if (Math.abs(clampedScore) < config.neutralThreshold) {
    direction = 'neutral';
  } else if (clampedScore > 0) {
    direction = 'bullish';
  } else {
    direction = 'bearish';
  }

  // Calculate confidence
  const signalsFactor = Math.min(1, signals.length / config.minSignals);
  const sourceFactor = Math.min(1, sources.size / 3);
  const confidence = (signalsFactor + sourceFactor) / 2;

  return {
    symbol: signals[0].symbol, // All signals should have same symbol
    score: clampedScore,
    direction,
    confidence,
    signalsUsed: signals.length,
    sourcesUsed: Array.from(sources),
  };
}

/**
 * Compute statistics grouped by source.
 * 
 * Returns average normalized score and signal count per source.
 */
export function computeBySourceStats(
  signals: NormalizedSentimentSignal[]
): Array<{ source: string; avgScore: number; signals: number }> {
  const bySource = new Map<string, { sum: number; count: number }>();

  for (const signal of signals) {
    const existing = bySource.get(signal.source);
    if (existing) {
      existing.sum += signal.normalizedScore;
      existing.count += 1;
    } else {
      bySource.set(signal.source, {
        sum: signal.normalizedScore,
        count: 1,
      });
    }
  }

  const stats: Array<{ source: string; avgScore: number; signals: number }> = [];
  for (const [source, data] of bySource.entries()) {
    stats.push({
      source,
      avgScore: data.sum / data.count,
      signals: data.count,
    });
  }

  // Sort by signal count (descending)
  stats.sort((a, b) => b.signals - a.signals);

  return stats;
}

/**
 * Derive top drivers/themes from signal labels.
 *
 * Groups signals by label, computes weighted contribution.
 * Returns top drivers sorted by weight. Uses internal id and user-facing label.
 */
const DRIVER_ID_TO_USER_LABEL: Record<string, string> = {
  price_momentum: 'recent price action',
  fear_greed_index: 'Crypto Fear & Greed index',
  news_headline: 'news headlines',
};

function getUserLabelForDriverId(internalId: string): string {
  return (
    DRIVER_ID_TO_USER_LABEL[internalId] ??
    (internalId === 'unknown' ? 'general market sentiment' : internalId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
  );
}

function getExplanationForDriver(internalId: string, avgScore: number): string {
  const direction = avgScore > 0.2 ? 'positive' : avgScore < -0.2 ? 'negative' : 'neutral';
  if (internalId === 'fear_greed_index') {
    const sentiment = avgScore < -0.2 ? 'strong fear (negative sentiment)' : avgScore > 0.2 ? 'greed (positive sentiment)' : 'neutral';
    return `The Fear & Greed index shows ${sentiment}.`;
  }
  if (internalId === 'price_momentum') {
    const move = avgScore > 0.2 ? 'positive' : avgScore < -0.2 ? 'negative' : 'neutral';
    return `Short- and medium-term price movement has been ${move}.`;
  }
  if (internalId === 'news_headline') {
    return `News sentiment is ${direction}.`;
  }
  if (internalId === 'unknown') {
    return 'general market sentiment';
  }
  return `${getUserLabelForDriverId(internalId)} sentiment is ${direction}.`;
}

export function deriveDrivers(signals: NormalizedSentimentSignal[]): SentimentDriver[] {
  // Group by label (internal id)
  const byLabel = new Map<
    string,
    { sumWeight: number; count: number; avgScore: number }
  >();

  for (const signal of signals) {
    const internalId = signal.label || 'unknown';
    const existing = byLabel.get(internalId);
    if (existing) {
      existing.sumWeight += signal.weight;
      existing.count += 1;
      existing.avgScore =
        (existing.avgScore * (existing.count - 1) + signal.normalizedScore) /
        existing.count;
    } else {
      byLabel.set(internalId, {
        sumWeight: signal.weight,
        count: 1,
        avgScore: signal.normalizedScore,
      });
    }
  }

  const drivers: SentimentDriver[] = [];
  for (const [internalId, data] of byLabel.entries()) {
    const weight = data.sumWeight * (1 + Math.log10(data.count + 1));
    const userLabel = getUserLabelForDriverId(internalId);
    const explanation = getExplanationForDriver(internalId, data.avgScore);

    drivers.push({
      id: internalId,
      label: userLabel,
      explanation,
      weight,
    });
  }

  drivers.sort((a, b) => b.weight - a.weight);
  return drivers.slice(0, 5);
}
