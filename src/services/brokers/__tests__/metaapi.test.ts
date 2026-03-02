import {
  mapMetaApiDealToTradeHistory,
  mapMetaApiOrderToTradeHistory,
} from '../metaapi';
import type {
  MetaApiMetatraderDeal,
  MetaApiMetatraderOrder,
} from '../../../types/metaapi';

describe('MetaApi Mapping Functions', () => {
  describe('mapMetaApiDealToTradeHistory', () => {
    it('should map a complete MetaApi deal to TradeHistory attributes', () => {
      // Example deal from MetaApi documentation
      const exampleDeal: MetaApiMetatraderDeal = {
        id: '33582357',
        type: 'DEAL_TYPE_BUY',
        entryType: 'DEAL_ENTRY_IN',
        positionId: '46648037',
        orderId: '46648037',
        time: '2020-04-17T04:30:03.223Z',
        brokerTime: '2020-04-17 07:30:03.223',
        profit: 0,
        commission: -0.42,
        swap: 0,
        volume: 0.12,
        price: 1.05782,
        symbol: 'AUDNZD',
        magic: 1000,
        platform: 'mt5',
        comment: 'Test comment',
        clientId: 'AS_AUDNZD_3zfxXl3RvJ',
        reason: 'DEAL_REASON_CLIENT',
        accountCurrencyExchangeRate: 1.0,
        stopLoss: 1.05,
        takeProfit: 1.06,
      };

      const accountId = 123;
      const result = mapMetaApiDealToTradeHistory(exampleDeal, accountId);

      // Verify IDs and foreign keys
      expect(result.accountId).toBe(accountId);
      expect(result.metaapiDealId).toBe('33582357');
      expect(result.dealId).toBe('33582357'); // Backward compatibility
      expect(result.positionId).toBe('46648037');
      expect(result.orderId).toBe('46648037');

      // Verify financial fields
      expect(result.profit).toBe(0);
      expect(result.commission).toBe(-0.42);
      expect(result.swap).toBe(0);
      expect(result.volume).toBe(0.12);
      expect(result.price).toBe(1.05782);

      // Verify time parsing (ISO string → Date)
      expect(result.time).toBeInstanceOf(Date);
      expect(result.time?.getTime()).toBe(new Date('2020-04-17T04:30:03.223Z').getTime());
      expect(result.timeOpen).toBeInstanceOf(Date); // Should also be set for backward compat
      expect(result.timeOpen?.getTime()).toBe(new Date('2020-04-17T04:30:03.223Z').getTime());
      expect(result.brokerTime).toBe('2020-04-17 07:30:03.223');

      // Verify enum values are preserved as strings
      expect(result.dealType).toBe('DEAL_TYPE_BUY');
      expect(result.type).toBe('DEAL_TYPE_BUY'); // Also in type field
      expect(result.entryType).toBe('DEAL_ENTRY_IN');
      expect(result.reason).toBe('DEAL_REASON_CLIENT');

      // Verify MetaApi-specific fields
      expect(result.symbol).toBe('AUDNZD');
      expect(result.magic).toBe(1000);
      expect(result.platform).toBe('mt5');
      expect(result.comment).toBe('Test comment');
      expect(result.clientId).toBe('AS_AUDNZD_3zfxXl3RvJ');
      expect(result.accountCurrencyExchangeRate).toBe(1.0);
      expect(result.stopLoss).toBe(1.05);
      expect(result.takeProfit).toBe(1.06);
    });

    it('should handle optional fields correctly', () => {
      const minimalDeal: MetaApiMetatraderDeal = {
        id: '12345',
        type: 'DEAL_TYPE_SELL',
        profit: 100.5,
        time: '2020-01-01T00:00:00.000Z',
        brokerTime: '2020-01-01 03:00:00.000',
        platform: 'mt4',
      };

      const accountId = 456;
      const result = mapMetaApiDealToTradeHistory(minimalDeal, accountId);

      // Required fields should be present
      expect(result.accountId).toBe(accountId);
      expect(result.metaapiDealId).toBe('12345');
      expect(result.dealType).toBe('DEAL_TYPE_SELL');
      expect(result.profit).toBe(100.5);
      expect(result.platform).toBe('mt4');
      expect(result.time).toBeInstanceOf(Date);

      // Optional fields should be null
      expect(result.positionId).toBeNull();
      expect(result.orderId).toBeNull();
      expect(result.entryType).toBeNull();
      expect(result.commission).toBeNull();
      expect(result.swap).toBeNull();
      expect(result.volume).toBeNull();
      expect(result.price).toBeNull();
      expect(result.symbol).toBeNull();
      expect(result.magic).toBeNull();
      expect(result.comment).toBeNull();
      expect(result.clientId).toBeNull();
      expect(result.reason).toBeNull();
    });

    it('should handle invalid time strings gracefully', () => {
      const dealWithInvalidTime: MetaApiMetatraderDeal = {
        id: '999',
        type: 'DEAL_TYPE_BUY',
        profit: 0,
        time: 'invalid-date',
        brokerTime: '2020-01-01 00:00:00.000',
        platform: 'mt5',
      };

      const result = mapMetaApiDealToTradeHistory(dealWithInvalidTime, 789);

      expect(result.time).toBeNull();
      expect(result.timeOpen).toBeNull();
    });
  });

  describe('mapMetaApiOrderToTradeHistory', () => {
    it('should map a complete MetaApi order to TradeHistory attributes', () => {
      // Example order from MetaApi documentation
      const exampleOrder: MetaApiMetatraderOrder = {
        id: '46648037',
        type: 'ORDER_TYPE_BUY',
        state: 'ORDER_STATE_FILLED',
        magic: 1000,
        time: '2020-04-17T04:30:02.966Z',
        brokerTime: '2020-04-17 07:30:02.966',
        doneTime: '2020-04-17T04:30:03.223Z',
        doneBrokerTime: '2020-04-17 07:30:03.223',
        symbol: 'AUDNZD',
        volume: 0.12,
        currentVolume: 0,
        platform: 'mt5',
        reason: 'ORDER_REASON_CLIENT',
        fillingMode: 'ORDER_FILLING_FOK',
        expirationType: 'ORDER_TIME_SPECIFIED',
        positionId: '46648037',
        openPrice: 1.05782,
        currentPrice: 1.05782,
        stopLoss: 1.05,
        takeProfit: 1.06,
        stopLimitPrice: 1.055,
        comment: 'Test order',
        clientId: 'AS_AUDNZD_3zfxXl3RvJ',
        trailingStopLoss: {
          distance: 10,
          step: 5,
        },
      };

      const accountId = 123;
      const result = mapMetaApiOrderToTradeHistory(exampleOrder, accountId);

      // Verify IDs and foreign keys
      expect(result.accountId).toBe(accountId);
      expect(result.metaapiOrderId).toBe('46648037');
      expect(result.orderId).toBe('46648037'); // Backward compatibility
      expect(result.positionId).toBe('46648037');

      // Verify order-specific fields
      expect(result.volume).toBe(0.12);
      expect(result.currentVolume).toBe(0);
      expect(result.price).toBe(1.05782); // Should use openPrice

      // Verify time parsing
      expect(result.time).toBeInstanceOf(Date);
      expect(result.time?.getTime()).toBe(new Date('2020-04-17T04:30:02.966Z').getTime());
      expect(result.timeOpen).toBeInstanceOf(Date);
      expect(result.doneTime).toBeInstanceOf(Date);
      expect(result.doneTime?.getTime()).toBe(new Date('2020-04-17T04:30:03.223Z').getTime());
      expect(result.brokerTime).toBe('2020-04-17 07:30:02.966');
      expect(result.doneBrokerTime).toBe('2020-04-17 07:30:03.223');

      // Verify enum values are preserved as strings
      expect(result.type).toBe('ORDER_TYPE_BUY');
      expect(result.orderState).toBe('ORDER_STATE_FILLED');
      expect(result.reason).toBe('ORDER_REASON_CLIENT');

      // Verify MetaApi-specific fields
      expect(result.symbol).toBe('AUDNZD');
      expect(result.magic).toBe(1000);
      expect(result.platform).toBe('mt5');
      expect(result.comment).toBe('Test order');
      expect(result.clientId).toBe('AS_AUDNZD_3zfxXl3RvJ');
      expect(result.stopLoss).toBe(1.05);
      expect(result.takeProfit).toBe(1.06);
      expect(result.stopLimitPrice).toBe(1.055);
      expect(result.trailingStopLoss).toEqual({
        distance: 10,
        step: 5,
      });
    });

    it('should handle orders without doneTime', () => {
      const pendingOrder: MetaApiMetatraderOrder = {
        id: '99999',
        type: 'ORDER_TYPE_BUY_LIMIT',
        state: 'ORDER_STATE_PLACED',
        magic: 2000,
        time: '2020-01-01T00:00:00.000Z',
        brokerTime: '2020-01-01 03:00:00.000',
        symbol: 'EURUSD',
        volume: 1.0,
        currentVolume: 1.0,
        platform: 'mt4',
        reason: 'ORDER_REASON_EXPERT',
        fillingMode: 'ORDER_FILLING_RETURN',
        expirationType: 'ORDER_TIME_GTC',
        openPrice: 1.1000,
        currentPrice: 1.1005,
      };

      const result = mapMetaApiOrderToTradeHistory(pendingOrder, 999);

      expect(result.doneTime).toBeNull();
      expect(result.doneBrokerTime).toBeNull();
      expect(result.currentVolume).toBe(1.0);
      expect(result.price).toBe(1.1000); // Should use openPrice when available
    });

    it('should use currentPrice when openPrice is not available', () => {
      const orderWithoutOpenPrice: MetaApiMetatraderOrder = {
        id: '88888',
        type: 'ORDER_TYPE_SELL',
        state: 'ORDER_STATE_FILLED',
        magic: 3000,
        time: '2020-01-01T00:00:00.000Z',
        brokerTime: '2020-01-01 03:00:00.000',
        symbol: 'GBPUSD',
        volume: 0.5,
        currentVolume: 0,
        platform: 'mt5',
        reason: 'ORDER_REASON_CLIENT',
        fillingMode: 'ORDER_FILLING_IOC',
        expirationType: 'ORDER_TIME_SPECIFIED',
        currentPrice: 1.2500,
      };

      const result = mapMetaApiOrderToTradeHistory(orderWithoutOpenPrice, 888);

      expect(result.price).toBe(1.2500); // Should fall back to currentPrice
    });

    it('should handle invalid time strings gracefully', () => {
      const orderWithInvalidTime: MetaApiMetatraderOrder = {
        id: '777',
        type: 'ORDER_TYPE_BUY',
        state: 'ORDER_STATE_PLACED',
        magic: 100,
        time: 'invalid-date',
        brokerTime: '2020-01-01 00:00:00.000',
        symbol: 'USDJPY',
        volume: 1.0,
        currentVolume: 1.0,
        platform: 'mt4',
        reason: 'ORDER_REASON_CLIENT',
        fillingMode: 'ORDER_FILLING_FOK',
        expirationType: 'ORDER_TIME_GTC',
      };

      const result = mapMetaApiOrderToTradeHistory(orderWithInvalidTime, 777);

      expect(result.time).toBeNull();
      expect(result.timeOpen).toBeNull();
    });
  });
});
