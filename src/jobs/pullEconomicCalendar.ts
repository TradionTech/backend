import { marketData } from '../services/market/marketData';

export async function pullEconomicCalendar() {
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  await marketData.getEconomicCalendar({ from, to });
}
