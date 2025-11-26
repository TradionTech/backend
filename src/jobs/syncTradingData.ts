import { MetaApiAccount } from '../db/models/MetaApiAccount';
import { AccountEquitySnapshot } from '../db/models/AccountEquitySnapshot';
import { TradingPosition } from '../db/models/TradingPosition';
import { getAccountSummary } from '../services/brokers/metaapi';

export async function syncTradingData() {
  const accounts = await MetaApiAccount.findAll({ where: { isActive: true } });
  for (const acc of accounts) {
    try {
      const metaId = acc.metaapiAccountId as string;
      const summary = await getAccountSummary(metaId);
      const info = summary.accountInfo;
      const positions = summary.positions || [];

      // Snapshot equity/balance
      await AccountEquitySnapshot.create({
        accountId: acc.id,
        balance: info?.balance ?? null,
        equity: info?.equity ?? null,
        margin: info?.margin ?? null,
        freeMargin: info?.freeMargin ?? null,
        currency: info?.currency ?? null,
      } as any);

      // Upsert positions by (accountId, positionId)
      for (const p of positions) {
        const values: any = {
          accountId: acc.id,
          positionId: String(p.id ?? p.positionId ?? ''),
          symbol: p.symbol,
          side: p.type === 'POSITION_TYPE_BUY' || p.type === 'buy' ? 'buy' : 'sell',
          volume: p.volume,
          priceOpen: p.price ?? p.priceOpen ?? null,
          sl: p.sl ?? null,
          tp: p.tp ?? null,
          profit: p.unrealizedProfit ?? p.profit ?? null,
        };
        const [row, created] = await TradingPosition.findOrCreate({
          where: { accountId: acc.id, positionId: values.positionId },
          defaults: values,
        });
        if (!created) await row.update(values);
      }

      await acc.update({ lastSyncedAt: new Date() } as any);
    } catch (e) {
      // Continue with other accounts
      console.error('syncTradingData error for account', acc.id, e);
    }
  }
}
