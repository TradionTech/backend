/**
 * MetaApi TypeScript Type Definitions
 * 
 * These types match the MetaApi documentation exactly:
 * - https://metaapi.cloud/docs/client/models/metatraderOrder/
 * - https://metaapi.cloud/docs/client/models/metatraderDeal/
 * 
 * All enum values are preserved as string literals to match MetaApi's API responses.
 */

/**
 * Order type enum values
 */
export type MetaApiOrderType =
  | 'ORDER_TYPE_BUY'
  | 'ORDER_TYPE_SELL'
  | 'ORDER_TYPE_BUY_LIMIT'
  | 'ORDER_TYPE_SELL_LIMIT'
  | 'ORDER_TYPE_BUY_STOP'
  | 'ORDER_TYPE_SELL_STOP'
  | 'ORDER_TYPE_BUY_STOP_LIMIT'
  | 'ORDER_TYPE_SELL_STOP_LIMIT'
  | 'ORDER_TYPE_CLOSE_BY';

/**
 * Order state enum values
 */
export type MetaApiOrderState =
  | 'ORDER_STATE_STARTED'
  | 'ORDER_STATE_PLACED'
  | 'ORDER_STATE_CANCELED'
  | 'ORDER_STATE_PARTIAL'
  | 'ORDER_STATE_FILLED'
  | 'ORDER_STATE_REJECTED'
  | 'ORDER_STATE_EXPIRED'
  | 'ORDER_STATE_REQUEST_ADD'
  | 'ORDER_STATE_REQUEST_MODIFY'
  | 'ORDER_STATE_REQUEST_CANCEL';

/**
 * Deal type enum values
 */
export type MetaApiDealType =
  | 'DEAL_TYPE_BUY'
  | 'DEAL_TYPE_SELL'
  | 'DEAL_TYPE_BALANCE'
  | 'DEAL_TYPE_CREDIT'
  | 'DEAL_TYPE_CHARGE'
  | 'DEAL_TYPE_CORRECTION'
  | 'DEAL_TYPE_BONUS'
  | 'DEAL_TYPE_COMMISSION'
  | 'DEAL_TYPE_COMMISSION_DAILY'
  | 'DEAL_TYPE_COMMISSION_MONTHLY'
  | 'DEAL_TYPE_COMMISSION_AGENT_DAILY'
  | 'DEAL_TYPE_COMMISSION_AGENT_MONTHLY'
  | 'DEAL_TYPE_INTEREST'
  | 'DEAL_TYPE_BUY_CANCELED'
  | 'DEAL_TYPE_SELL_CANCELED'
  | 'DEAL_DIVIDEND'
  | 'DEAL_DIVIDEND_FRANKED'
  | 'DEAL_TAX';

/**
 * Deal entry type enum values
 */
export type MetaApiDealEntryType =
  | 'DEAL_ENTRY_IN'
  | 'DEAL_ENTRY_OUT'
  | 'DEAL_ENTRY_INOUT'
  | 'DEAL_ENTRY_OUT_BY';

/**
 * Deal reason enum values
 */
export type MetaApiDealReason =
  | 'DEAL_REASON_CLIENT'
  | 'DEAL_REASON_MOBILE'
  | 'DEAL_REASON_WEB'
  | 'DEAL_REASON_EXPERT'
  | 'DEAL_REASON_SL'
  | 'DEAL_REASON_TP'
  | 'DEAL_REASON_SO'
  | 'DEAL_REASON_ROLLOVER'
  | 'DEAL_REASON_VMARGIN'
  | 'DEAL_REASON_SPLIT'
  | 'DEAL_REASON_UNKNOWN';

/**
 * Order reason enum values
 */
export type MetaApiOrderReason =
  | 'ORDER_REASON_CLIENT'
  | 'ORDER_REASON_MOBILE'
  | 'ORDER_REASON_WEB'
  | 'ORDER_REASON_EXPERT'
  | 'ORDER_REASON_SL'
  | 'ORDER_REASON_TP'
  | 'ORDER_REASON_SO'
  | 'ORDER_REASON_UNKNOWN';

/**
 * Order filling mode enum values
 */
export type MetaApiFillingMode =
  | 'ORDER_FILLING_FOK'
  | 'ORDER_FILLING_IOC'
  | 'ORDER_FILLING_RETURN';

/**
 * Platform type
 */
export type MetaApiPlatform = 'mt4' | 'mt5';

/**
 * Trailing stop loss configuration
 */
export interface MetaApiTrailingStopLoss {
  distance?: number;
  step?: number;
}

/**
 * MetatraderDeal interface matching MetaApi documentation
 * 
 * Required fields: id, type, profit, time, brokerTime, platform
 * All other fields are optional as per MetaApi docs
 */
export interface MetaApiMetatraderDeal {
  /** Deal ticket/ID (required) */
  id: string;
  /** Deal type enum (required) */
  type: MetaApiDealType;
  /** Deal profit (required) */
  profit: number;
  /** Deal execution time in ISO 8601 format (required) */
  time: string;
  /** Time in broker timezone YYYY-MM-DD HH:mm:ss.SSS (required) */
  brokerTime: string;
  /** Platform: mt4 or mt5 (required) */
  platform: MetaApiPlatform;

  /** Deal entry type enum (optional) */
  entryType?: MetaApiDealEntryType;
  /** Trading symbol (optional) */
  symbol?: string;
  /** EA identifier (optional) */
  magic?: number;
  /** Deal volume/lot size (optional) */
  volume?: number;
  /** Execution price (optional) */
  price?: number;
  /** Deal commission (optional) */
  commission?: number;
  /** Deal swap/interest (optional) */
  swap?: number;
  /** Related position ID (optional) */
  positionId?: string;
  /** Related order ID (optional) */
  orderId?: string;
  /** Deal comment, max 26 chars combined with clientId (optional) */
  comment?: string;
  /** Broker-side comment (optional) */
  brokerComment?: string;
  /** Client-assigned ID for tracking, max 26 chars combined with comment (optional) */
  clientId?: string;
  /** Execution reason enum (optional) */
  reason?: MetaApiDealReason;
  /** Account currency to base currency exchange rate (optional) */
  accountCurrencyExchangeRate?: number;
  /** Position stop loss at deal time (optional) */
  stopLoss?: number;
  /** Position take profit at deal time (optional) */
  takeProfit?: number;
}

/**
 * MetatraderOrder interface matching MetaApi documentation
 * 
 * Required fields: id, type, state, magic, time, brokerTime, symbol, volume, currentVolume, platform, reason, fillingMode, expirationType
 * All other fields are optional as per MetaApi docs
 */
export interface MetaApiMetatraderOrder {
  /** Order ticket/ID (required) */
  id: string;
  /** Order type enum (required) */
  type: MetaApiOrderType;
  /** Order state enum (required) */
  state: MetaApiOrderState;
  /** EA identifier (required) */
  magic: number;
  /** Order creation time in ISO 8601 format (required) */
  time: string;
  /** Creation time in broker timezone YYYY-MM-DD HH:mm:ss.SSS (required) */
  brokerTime: string;
  /** Order symbol (required) */
  symbol: string;
  /** Requested quantity (required) */
  volume: number;
  /** Remaining/unfilled quantity (required) */
  currentVolume: number;
  /** Platform: mt4 or mt5 (required) */
  platform: MetaApiPlatform;
  /** Opening reason enum (required) */
  reason: MetaApiOrderReason;
  /** Filling mode enum (required) */
  fillingMode: MetaApiFillingMode;
  /** Expiration type (required) */
  expirationType: string;

  /** Execution/cancellation time in ISO 8601 format (optional, for completed orders) */
  doneTime?: string;
  /** Execution time in broker timezone (optional) */
  doneBrokerTime?: string;
  /** Order open price, required for pending orders (optional) */
  openPrice?: number;
  /** Limit price for StopLimit orders (optional) */
  stopLimitPrice?: number;
  /** Current price, filled for pending orders only (optional) */
  currentPrice?: number;
  /** Stop loss price (optional) */
  stopLoss?: number;
  /** Take profit price (optional) */
  takeProfit?: number;
  /** Related position ID (optional) */
  positionId?: string;
  /** Order comment, max 26 chars combined with clientId (optional) */
  comment?: string;
  /** Broker-side comment (optional) */
  brokerComment?: string;
  /** Client-assigned ID for tracking (optional) */
  clientId?: string;
  /** Trailing stop loss configuration (optional) */
  trailingStopLoss?: MetaApiTrailingStopLoss;
}
