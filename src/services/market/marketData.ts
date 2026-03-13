import axios from 'axios';
import { env } from '../../config/env';

const client = axios.create({
  baseURL: env.MARKET_API_BASE_URL,
});

export const marketData = {
  async getPrices(params: { symbols: string[]; timeframe?: string; limit?: number }) {
    const { data } = await client.get('/prices', {
      headers: { 'x-api-key': env.MARKET_API_KEY },
      params,
    });
    return data;
  },
  async getSentiment(params: { symbol: string }) {
    const { data } = await client.get('/sentiment', {
      headers: { 'x-api-key': env.MARKET_API_KEY },
      params,
    });
    return data;
  },
};
