import { DataTypes, Model, Sequelize } from 'sequelize';

export class TradeHistory extends Model {
  declare id: number;
  declare accountId: number;
  declare orderId: string | null;
  declare dealId: string | null;
  declare symbol: string | null;
  declare type: string | null;
  declare volume: number | null;
  declare price: number | null;
  declare commission: number | null;
  declare swap: number | null;
  declare profit: number | null;
  declare timeOpen: Date | null;
  declare timeClose: Date | null;
  declare comment: string | null;

  // MetaApi-specific fields (all nullable for backward compatibility)
  /** MetaTrader position ID - links to TradingPosition.positionId */
  declare positionId: string | null;
  /** MetaApi deal ID (from deal.id field) - distinguishes from our auto-increment id */
  declare metaapiDealId: string | null;
  /** MetaApi order ID (from order.id field) - distinguishes from our auto-increment id */
  declare metaapiOrderId: string | null;
  /** EA identifier (magic number) */
  declare magic: number | null;
  /** Platform type: mt4 or mt5 */
  declare platform: 'mt4' | 'mt5' | null;
  /** Deal entry type enum (DEAL_ENTRY_IN, DEAL_ENTRY_OUT, etc.) */
  declare entryType: string | null;
  /** Deal type enum (DEAL_TYPE_BUY, DEAL_TYPE_SELL, etc.) - alias for type when from deal */
  declare dealType: string | null;
  /** Order state enum (ORDER_STATE_FILLED, ORDER_STATE_CANCELED, etc.) */
  declare orderState: string | null;
  /** Broker timezone time (YYYY-MM-DD HH:mm:ss.SSS format) */
  declare brokerTime: string | null;
  /** Order completion time (ISO 8601, converted to Date) */
  declare doneTime: Date | null;
  /** Order completion broker time (YYYY-MM-DD HH:mm:ss.SSS format) */
  declare doneBrokerTime: string | null;
  /** Remaining order volume (for orders) */
  declare currentVolume: number | null;
  /** Stop loss price */
  declare stopLoss: number | null;
  /** Take profit price */
  declare takeProfit: number | null;
  /** Client-assigned ID for tracking */
  declare clientId: string | null;
  /** Broker-side comment */
  declare brokerComment: string | null;
  /** Execution reason enum (DEAL_REASON_*, ORDER_REASON_*) */
  declare reason: string | null;
  /** Account currency to base currency exchange rate */
  declare accountCurrencyExchangeRate: number | null;
  /** Limit price for StopLimit orders */
  declare stopLimitPrice: number | null;
  /** Trailing stop loss configuration (stored as JSONB) */
  declare trailingStopLoss: object | null;
  /** Canonical MetaApi time (ISO 8601, converted to Date) - maps from deal.time or order.time */
  declare time: Date | null;
}

export function initTradeHistory(sequelize: Sequelize) {
  TradeHistory.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      accountId: { type: DataTypes.BIGINT, allowNull: false },
      orderId: { type: DataTypes.STRING, allowNull: true },
      dealId: { type: DataTypes.STRING, allowNull: true },
      symbol: { type: DataTypes.STRING, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: true },
      volume: { type: DataTypes.DECIMAL, allowNull: true },
      price: { type: DataTypes.DECIMAL, allowNull: true },
      commission: { type: DataTypes.DECIMAL, allowNull: true },
      swap: { type: DataTypes.DECIMAL, allowNull: true },
      profit: { type: DataTypes.DECIMAL, allowNull: true },
      timeOpen: { type: DataTypes.DATE, allowNull: true },
      timeClose: { type: DataTypes.DATE, allowNull: true },
      comment: { type: DataTypes.STRING, allowNull: true },

      // MetaApi-specific fields (all nullable for backward compatibility)
      positionId: { type: DataTypes.STRING, allowNull: true },
      metaapiDealId: { type: DataTypes.STRING, allowNull: true },
      metaapiOrderId: { type: DataTypes.STRING, allowNull: true },
      magic: { type: DataTypes.INTEGER, allowNull: true },
      platform: { type: DataTypes.ENUM('mt4', 'mt5'), allowNull: true },
      entryType: { type: DataTypes.STRING, allowNull: true },
      dealType: { type: DataTypes.STRING, allowNull: true },
      orderState: { type: DataTypes.STRING, allowNull: true },
      brokerTime: { type: DataTypes.STRING, allowNull: true },
      doneTime: { type: DataTypes.DATE, allowNull: true },
      doneBrokerTime: { type: DataTypes.STRING, allowNull: true },
      currentVolume: { type: DataTypes.DECIMAL, allowNull: true },
      stopLoss: { type: DataTypes.DECIMAL, allowNull: true },
      takeProfit: { type: DataTypes.DECIMAL, allowNull: true },
      clientId: { type: DataTypes.STRING, allowNull: true },
      brokerComment: { type: DataTypes.STRING, allowNull: true },
      reason: { type: DataTypes.STRING, allowNull: true },
      accountCurrencyExchangeRate: { type: DataTypes.DECIMAL, allowNull: true },
      stopLimitPrice: { type: DataTypes.DECIMAL, allowNull: true },
      trailingStopLoss: { type: DataTypes.JSONB, allowNull: true },
      time: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'TradeHistory',
      tableName: 'trade_history',
      indexes: [
        { fields: ['accountId'] },
        { fields: ['accountId', 'timeOpen'] },
        { fields: ['positionId'] },
        { fields: ['accountId', 'metaapiDealId'] },
        { fields: ['accountId', 'metaapiOrderId'] },
      ],
    }
  );
}
