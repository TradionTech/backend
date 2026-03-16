/**
 * DB-backed HistoryStorage for MetaAPI streaming. Persists deals and orders to TradeHistory.
 * Resolves metaapiAccountId to internal accountId via MetaApiAccount. Uses in-memory cache for reads.
 * Cast as HistoryStorage when passing to getStreamingConnection().
 *
 * The SDK also registers this object as a SynchronizationListener and calls every callback for
 * every event. We implement all listener methods as no-ops so "listener.x is not a function"
 * errors do not occur; only deal/order merge and sync state are used.
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

  /** SDK uses this for incremental order sync. Must return a Date (SDK calls .getTime() on it). */
  lastHistoryOrderTime(): Date {
    if (this._ordersCache.length === 0) return new Date(0);
    let latest: Date = new Date(0);
    for (const o of this._ordersCache) {
      const t = (o as { time?: string }).time;
      if (!t) continue;
      const d = new Date(t);
      if (d.getTime() > latest.getTime()) latest = d;
    }
    return latest;
  }

  /** SDK may use for incremental deal sync. Must return a Date (SDK calls .getTime() on it). */
  lastHistoryDealTime(): Date {
    if (this._dealsCache.length === 0) return new Date(0);
    let latest: Date = new Date(0);
    for (const d of this._dealsCache) {
      const t = (d as { time?: string }).time;
      if (!t) continue;
      const date = new Date(t);
      if (date.getTime() > latest.getTime()) latest = date;
    }
    return latest;
  }

  /** SDK calls this name (alias for lastHistoryDealTime). */
  lastDealTime(): Date {
    return this.lastHistoryDealTime();
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

  /**
   * Called by MetaAPI SDK when the streaming connection uses this storage.
   * Loads existing deals/orders from DB into cache.
   */
  initialize(): Promise<void> {
    return this.loadFromDb();
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

  // --- SynchronizationListener no-ops (SDK registers this object as a listener and calls every callback) ---
  onConnected(): void {}
  onSynchronizationStarted(_instanceIndex?: string): void {}
  onBrokerConnectionStatusChanged(_instanceIndex: string, _connected: boolean): void {}
  onHealthStatus(_instanceIndex: string, _status: unknown): void {}
  onSymbolSpecificationUpdated(_instanceIndex: string, _specification?: unknown): void {}
  onSymbolSpecificationsUpdated(_instanceIndex: string, _specifications?: unknown): void {}
  onSymbolPriceUpdated(_instanceIndex: string, _price?: unknown): void {}
  onSymbolPricesUpdated(_instanceIndex: string, _prices?: unknown): void {}
  onAccountInformationUpdated(_instanceIndex: string, _accountInformation: unknown): void {}
  onPositionsReplaced(_instanceIndex: string, _positions: unknown[]): void {}
  onPositionsUpdated(_instanceIndex: string, _positions?: unknown[]): void {}
  onPositionsSynchronized(_instanceIndex: string, _synchronizationId?: string): void {}
  onPositionUpdated(_instanceIndex: string, _position: unknown): void {}
  onPositionRemoved(_instanceIndex: string, _positionId: string): void {}
  onPendingOrdersReplaced(_instanceIndex: string, _orders: unknown[]): void {}
  onPendingOrdersSynchronized(_instanceIndex: string, _synchronizationId?: string): void {}
  onOrderUpdated(_instanceIndex: string, _order: unknown): void {}
  onOrderCompleted(_instanceIndex: string, _order: unknown): void {}
  onOrderSynchronizationFinished(_instanceIndex: string, _synchronizationId: string): void {}
  onHistoryOrdersSynchronized(_instanceIndex?: string, _synchronizationId?: string): void {}
  onHistoryOrderAdded(_instanceIndex: string, _order: unknown): void {}
  onDealSynchronizationFinished(_instanceIndex: string, _synchronizationId: string): void {}
  onDealsSynchronized(_instanceIndex?: string, _synchronizationId?: string): void {}
  onDealAdded(_instanceIndex: string, _deal: unknown): void {}
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
