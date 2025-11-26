import cron from 'node-cron';
import { env } from '../config/env.js';
import { pullPrices } from './pullPrices.js';
import { pullSentiment } from './pullSentiment.js';
import { pullEconomicCalendar } from './pullEconomicCalendar.js';
import { syncTradingData } from './syncTradingData.js';

if (!env.ENABLE_JOBS) {
  console.log('Jobs disabled');
  process.exit(0);
}

// Every minute (tune to provider limits)
cron.schedule('* * * * *', async () => {
  await pullPrices().catch(console.error);
});

// Every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  await pullSentiment().catch(console.error);
});

// Hourly econ calendar refresh
cron.schedule('0 * * * *', async () => {
  await pullEconomicCalendar().catch(console.error);
});

// Every 10 minutes: sync trading data per linked accounts
cron.schedule('*/10 * * * *', async () => {
  await syncTradingData().catch(console.error);
});
