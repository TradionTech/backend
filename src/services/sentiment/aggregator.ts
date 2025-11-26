import { marketData } from '../market/marketData';

export const aggregator = {
  async score(symbol: string) {
    const s = await marketData.getSentiment({ symbol });
    const score = Number(s?.score ?? 50);
    const trend = s?.trend ?? (score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'neutral');
    const drivers = Array.isArray(s?.drivers)
      ? s.drivers
          .slice(0, 3)
          .map((d: any) => ({ text: d?.text ?? String(d), impact: d?.impact ?? 0.33 }))
      : [];
    return { score, trend, top_drivers: drivers };
  },
};
