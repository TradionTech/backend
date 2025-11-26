import { marketData } from '../services/market/marketData.js';

export async function pullPrices() {
  // Fetch consolidated prices via external market API
  await marketData.getPrices({ symbols: ['BTCUSDT', 'ETHUSDT'], timeframe: '1m', limit: 50 });
}
