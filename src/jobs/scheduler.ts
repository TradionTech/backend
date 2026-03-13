import cron from 'node-cron';
import { env } from '../config/env';
import { syncTradingData } from './syncTradingData';
import { syncEconomicCalendar } from './syncEconomicCalendar';

if (!env.ENABLE_JOBS) {
  console.log('Jobs disabled');
  process.exit(0);
}

// Every 10 minutes: sync trading data per linked accounts
cron.schedule('*/10 * * * *', async () => {
  await syncTradingData().catch(console.error);
});

// Twice daily: sync economic calendar from RapidAPI (06:00 and 18:00)
cron.schedule('0 6,18 * * *', async () => {
  await syncEconomicCalendar().catch(console.error);
});
