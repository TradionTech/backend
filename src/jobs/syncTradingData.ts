import type { MetatraderPosition } from 'metaapi.cloud-sdk';
import { MetaApiAccount } from '../db/models/MetaApiAccount';
import { AccountEquitySnapshot } from '../db/models/AccountEquitySnapshot';
import { TradingPosition } from '../db/models/TradingPosition';
import { TradeHistory } from '../db/models/TradeHistory';
import {
  getAccountSummary,
  getHistoryDealsByPosition,
  getHistoryOrdersByPosition,
  mapMetaApiDealToTradeHistory,
  mapMetaApiOrderToTradeHistory,
  syncAccountStateToDb,
} from '../services/brokers/metaapi';
import { logger } from '../config/logger';
import { createRedisPublisher, publishAccountUpdate } from '../streaming/accountUpdateBus';

let publisher = createRedisPublisher();

function getPublisher() {
  if (!publisher) {
    publisher = createRedisPublisher();
  }
  return publisher;
}

function isMetaApiAuthError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('we were not able to connect to your broker using credentials provided') ||
    lower.includes('we failed to authenticate to your broker using credentials provided') ||
    lower.includes('e_auth')
  );
}

type PositionWithLegacyId = MetatraderPosition & {
  positionId?: string;
  price?: number;
  priceOpen?: number;
  sl?: number;
  tp?: number;
};

/**
 * Sync trading data for a single MetaAPI account: ensure account is deployed/connected,
 * then fetch summary, positions, and history into DB. Use this when journal or other
 * features need fresh data and the account may be UNDEPLOYED or DISCONNECTED.
 */
export async function syncTradingDataForAccount(
  acc: MetaApiAccount
): Promise<void> {
  const metaId = acc.metaapiAccountId as string;
  await syncAccountStateToDb(metaId).catch((e) =>
    logger.warn('syncTradingDataForAccount: syncAccountStateToDb failed', {
      metaId,
      err: (e as Error)?.message,
    })
  );
  // ensureConnected deploys and waits if account is UNDEPLOYED/DISCONNECTED
  const summary = await getAccountSummary(metaId);
  const info = summary.accountInfo;
  const positions = (summary.positions || []) as PositionWithLegacyId[];

  await AccountEquitySnapshot.create({
    accountId: acc.id,
    balance: info?.balance ?? null,
    equity: info?.equity ?? null,
    margin: info?.margin ?? null,
    freeMargin: info?.freeMargin ?? null,
    currency: info?.currency ?? null,
  } as any);

  const syncedPositionIds: string[] = [];
  for (const p of positions) {
    const positionId = String(p.id ?? p.positionId ?? '');
    const values: any = {
      accountId: acc.id,
      positionId,
      symbol: p.symbol,
      side: p.type === 'POSITION_TYPE_BUY' || p.type === 'buy' ? 'buy' : 'sell',
      volume: p.volume,
      priceOpen: p.price ?? p.priceOpen ?? null,
      sl: p.sl ?? null,
      tp: p.tp ?? null,
      profit: p.unrealizedProfit ?? p.profit ?? null,
    };
    const [row, created] = await TradingPosition.findOrCreate({
      where: { accountId: acc.id, positionId },
      defaults: values,
    });
    if (!created) await row.update(values);
    syncedPositionIds.push(positionId);
  }

  const allPositionIds = new Set<string>(syncedPositionIds);
  const existingHistory = await TradeHistory.findAll({
    where: { accountId: acc.id },
    attributes: ['positionId'],
    group: ['positionId'],
  });
  for (const h of existingHistory) {
    if (h.positionId) allPositionIds.add(h.positionId);
  }

  for (const positionId of allPositionIds) {
    try {
      const deals = await getHistoryDealsByPosition(metaId, positionId);
      for (const deal of deals) {
        const dealAttributes = mapMetaApiDealToTradeHistory(deal, acc.id);
        await TradeHistory.findOrCreate({
          where: { accountId: acc.id, metaapiDealId: deal.id },
          defaults: dealAttributes as any,
        });
        const existingDeal = await TradeHistory.findOne({
          where: { accountId: acc.id, metaapiDealId: deal.id },
        });
        if (existingDeal) await existingDeal.update(dealAttributes as any);
      }
    } catch (historyErr: any) {
      logger.warn('syncTradingDataForAccount: history sync failed for position', {
        accountId: acc.id,
        positionId,
        err: historyErr?.message,
      });
    }
  }

  await acc.update({ lastSyncedAt: new Date() } as any);
}

export async function syncTradingData() {
  const accounts = await MetaApiAccount.findAll({ where: { isActive: true } });
  for (const acc of accounts) {
    try {
      await syncTradingDataForAccount(acc);
    } catch (e) {
      const message = (e as Error)?.message;
      logger.error('syncTradingData error for account', { accountId: acc.id, err: message });

      if (isMetaApiAuthError(message)) {
        const pub = getPublisher();
        if (pub) {
          publishAccountUpdate(pub, {
            type: 'credential_issue',
            accountId: acc.metaapiAccountId as string,
            code: 'METAAPI_AUTH_FAILED',
            message:
              'We were not able to connect to your broker using credentials provided. Please verify your login, password, and server or confirm account deletion.',
          });
        }
      }
    }
  }
}
