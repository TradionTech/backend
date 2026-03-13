/**
 * DB-backed HistoryStorage for MetaAPI streaming. Persists deals and orders to TradeHistory.
 * Resolves metaapiAccountId to internal accountId via MetaApiAccount. Uses in-memory cache for reads.
 * Cast as HistoryStorage when passing to getStreamingConnection().
 */

import { Op } from 'sequelize';
import { MetaApiAccount } from '../../db/models/MetaApiAccount';
import { TradeHistory } from '../../db/models/TradeHistory';
import {
  mapMetaApiDealToTradeHistory,
  mapMetaApiOrderToTradeHistory,
} from './metaapi';
import type { MetaApiMetatraderDeal, MetaApiMetatraderOrder } from '../../types/metaapi';
import { logger } from '../../config/logger';

/** Convert TradeHistory row to deal-like object (id, type, time, etc.) for SDK compatibility. */
function rowToDealLike(row: TradeHistory): Record<string, unknown> {
  return {
    id: row.metaapiDealId ?? row.dealId,
    type: row.dealType ?? row.type,
    time: row.time?.toISOString(),
    brokerTime: row.brokerTime,
    platform: row.platform,
    symbol: row.symbol,
    volume: row.volume,
    price: row.price,
    profit: row.profit,
    commission: row.commission,
    swap: row.swap,
    positionId: row.positionId,
    orderId: row.orderId,
    entryType: row.entryType,
    magic: row.magic,
    comment: row.comment,
    brokerComment: row.brokerComment,
    reason: row.reason,
    accountCurrencyExchangeRate: row.accountCurrencyExchangeRate,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
  };
}

/** Convert TradeHistory row to order-like object for SDK compatibility. */
function rowToOrderLike(row: TradeHistory): Record<string, unknown> {
  return {
    id: row.metaapiOrderId ?? row.orderId,
    type: row.type,
    state: row.orderState,
    magic: row.magic,
    time: row.time?.toISOString(),
    brokerTime: row.brokerTime,
    symbol: row.symbol,
    volume: row.volume,
    currentVolume: row.currentVolume,
    platform: row.platform,
    reason: row.reason,
    openPrice: row.price,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    positionId: row.positionId,
    doneTime: row.doneTime?.toISOString(),
    doneBrokerTime: row.doneBrokerTime,
    comment: row.comment,
    brokerComment: row.brokerComment,
    clientId: row.clientId,
  };
}

/**
 * Sequelize-backed HistoryStorage. Pass internal accountId (from MetaApiAccount.id).
 */
export class SequelizeHistoryStorage {
  private _orderSyncFinished = false;
  private _dealSyncFinished = false;
  private _dealsCache: Record<string, unknown>[] = [];
  private _ordersCache: Record<string, unknown>[] = [];

  constructor(private readonly internalAccountId: number) {}

  get orderSynchronizationFinished(): boolean {
    return this._orderSyncFinished;
  }

  get dealSynchronizationFinished(): boolean {
    return this._dealSyncFinished;
  }

  get deals(): Record<string, unknown>[] {
    return this._dealsCache.length > 0 ? this._dealsCache : [];
  }

  dealsByTicket(ticket: string): Record<string, unknown>[] {
    return this.deals.filter((d) => String((d as { id?: string }).id) === ticket);
  }

  dealsByPosition(positionId: string): Record<string, unknown>[] {
    return this.deals.filter((d) => (d as { positionId?: string }).positionId === positionId);
  }

  dealsByTimeRange(start: Date, end: Date): Record<string, unknown>[] {
    return this.deals.filter((d) => {
      const t = (d as { time?: string }).time;
      if (!t) return false;
      const date = new Date(t);
      return date >= start && date <= end;
    });
  }

  get historyOrders(): Record<string, unknown>[] {
    return this._ordersCache.length > 0 ? this._ordersCache : [];
  }

  historyOrdersByTicket(ticket: string): Record<string, unknown>[] {
    return this.historyOrders.filter((o) => String((o as { id?: string }).id) === ticket);
  }

  historyOrdersByPosition(positionId: string): Record<string, unknown>[] {
    return this.historyOrders.filter((o) => (o as { positionId?: string }).positionId === positionId);
  }

  historyOrdersByTimeRange(start: Date, end: Date): Record<string, unknown>[] {
    return this.historyOrders.filter((o) => {
      const t = (o as { time?: string }).time;
      if (!t) return false;
      const date = new Date(t);
      return date >= start && date <= end;
    });
  }

  /** Load deals/orders from DB into cache. Call before or after sync. */
  async loadFromDb(): Promise<void> {
    const dealRows = await TradeHistory.findAll({
      where: { accountId: this.internalAccountId, metaapiDealId: { [Op.ne]: null } },
      order: [['time', 'ASC']],
    });
    const orderRows = await TradeHistory.findAll({
      where: { accountId: this.internalAccountId, metaapiOrderId: { [Op.ne]: null } },
      order: [['time', 'ASC']],
    });
    this._dealsCache = dealRows.map((r) => rowToDealLike(r));
    this._ordersCache = orderRows.map((r) => rowToOrderLike(r));
  }

  setOrderSynchronizationFinished(value: boolean): void {
    this._orderSyncFinished = value;
  }

  setDealSynchronizationFinished(value: boolean): void {
    this._dealSyncFinished = value;
  }

  mergeDeals(deals: unknown[]): void {
    if (!deals?.length) return;
    (async () => {
      for (const d of deals as MetaApiMetatraderDeal[]) {
        try {
          const attrs = mapMetaApiDealToTradeHistory(d, this.internalAccountId);
          const [existing] = await TradeHistory.findOrCreate({
            where: { accountId: this.internalAccountId, metaapiDealId: d.id },
            defaults: attrs as Record<string, unknown>,
          });
          await existing.update(attrs as Record<string, unknown>);
          const idx = this._dealsCache.findIndex((x) => (x as { id?: string }).id === d.id);
          if (idx >= 0) this._dealsCache.splice(idx, 1);
          this._dealsCache.push(rowToDealLike(existing));
        } catch (e) {
          logger.warn('SequelizeHistoryStorage.mergeDeals item failed', {
            accountId: this.internalAccountId,
            dealId: d?.id,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
  }

  mergeOrders(orders: unknown[]): void {
    if (!orders?.length) return;
    (async () => {
      for (const o of orders as MetaApiMetatraderOrder[]) {
        try {
          const attrs = mapMetaApiOrderToTradeHistory(o, this.internalAccountId);
          const [existing] = await TradeHistory.findOrCreate({
            where: { accountId: this.internalAccountId, metaapiOrderId: o.id },
            defaults: attrs as Record<string, unknown>,
          });
          await existing.update(attrs as Record<string, unknown>);
          const idx = this._ordersCache.findIndex((x) => (x as { id?: string }).id === o.id);
          if (idx >= 0) this._ordersCache.splice(idx, 1);
          this._ordersCache.push(rowToOrderLike(existing));
        } catch (e) {
          logger.warn('SequelizeHistoryStorage.mergeOrders item failed', {
            accountId: this.internalAccountId,
            orderId: o?.id,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
  }
}

/** Create HistoryStorage for a MetaAPI account. Resolves metaapiAccountId to internal accountId. */
export async function createSequelizeHistoryStorage(
  metaapiAccountId: string
): Promise<SequelizeHistoryStorage | null> {
  const row = await MetaApiAccount.findOne({ where: { metaapiAccountId } });
  if (!row) {
    logger.warn('SequelizeHistoryStorage: MetaApiAccount not found', { metaapiAccountId });
    return null;
  }
  const storage = new SequelizeHistoryStorage(row.id);
  await storage.loadFromDb();
  return storage;
}
