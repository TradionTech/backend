import { marketData } from '../services/market/marketData.js';
import { SentimentScore } from '../db/models/SentimentScore.js';

export async function pullSentiment() {
  const sentiment = await marketData.getSentiment({ symbol: 'BTC' });
  const score: number = Number(sentiment?.score ?? 50);
  const trend: string =
    sentiment?.trend ?? (score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'neutral');
  const drivers = Array.isArray(sentiment?.drivers) ? sentiment.drivers.slice(0, 3) : [];

  await SentimentScore.create({
    userId: null,
    symbol: 'BTC',
    score,
    trend,
    drivers,
    timestamp: new Date(),
  });
}
