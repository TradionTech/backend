import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { initSequelize } from '../db/sequelize';
import { syncTradingData } from './syncTradingData';
import { syncEconomicCalendar } from './syncEconomicCalendar';

if (!env.ENABLE_JOBS) {
  console.log('Jobs disabled');
  process.exit(0);
}

/** Run all sync jobs once on startup, then start scheduled runs. */
async function runStartupSync() {
  logger.debug('Jobs: running startup sync (trading data + economic calendar)');
  await syncTradingData().catch((err) => {
    logger.error('Jobs: startup syncTradingData failed', { err: (err as Error)?.message });
  });
  await syncEconomicCalendar().catch((err) => {
    logger.error('Jobs: startup syncEconomicCalendar failed', { err: (err as Error)?.message });
  });
  logger.debug('Jobs: startup sync completed');
}

async function startScheduler() {
  await initSequelize().catch((err) => {
    logger.error('Jobs: DB init failed', { err: (err as Error)?.message });
  });
  await runStartupSync();
  // Every 10 minutes: sync trading data per linked accounts
  cron.schedule('*/10 * * * *', async () => {
    logger.debug('Jobs: running scheduled syncTradingData');
    await syncTradingData().catch((err) => {
      logger.error('Jobs: scheduled syncTradingData failed', { err: (err as Error)?.message });
    });
  });

  // Twice daily: sync economic calendar from RapidAPI (06:00 and 18:00)
  cron.schedule('0 6,18 * * *', async () => {
    logger.debug('Jobs: running scheduled syncEconomicCalendar');
    await syncEconomicCalendar().catch((err) => {
      logger.error('Jobs: scheduled syncEconomicCalendar failed', { err: (err as Error)?.message });
    });
  });

  logger.debug('Jobs: scheduler started (syncTradingData every 10m, syncEconomicCalendar at 06:00 and 18:00)');
}

void startScheduler();
