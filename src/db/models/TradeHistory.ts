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
    },
    {
      sequelize,
      modelName: 'TradeHistory',
      tableName: 'trade_history',
      indexes: [{ fields: ['accountId'] }, { fields: ['accountId', 'timeOpen'] }],
    }
  );
}
