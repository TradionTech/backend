import { DataTypes, Model, Sequelize } from 'sequelize';

export class TradingPosition extends Model {
  declare id: number;
  declare accountId: number;
  declare positionId: string;
  declare symbol: string;
  declare side: 'buy' | 'sell' | null;
  declare volume: number | null;
  declare priceOpen: number | null;
  declare sl: number | null;
  declare tp: number | null;
  declare profit: number | null;
  declare updatedAt: Date;
}

export function initTradingPosition(sequelize: Sequelize) {
  TradingPosition.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      accountId: { type: DataTypes.BIGINT, allowNull: false },
      positionId: { type: DataTypes.STRING, allowNull: false },
      symbol: { type: DataTypes.STRING, allowNull: false },
      side: { type: DataTypes.ENUM('buy', 'sell'), allowNull: true },
      volume: { type: DataTypes.DECIMAL, allowNull: true },
      priceOpen: { type: DataTypes.DECIMAL, allowNull: true },
      sl: { type: DataTypes.DECIMAL, allowNull: true },
      tp: { type: DataTypes.DECIMAL, allowNull: true },
      profit: { type: DataTypes.DECIMAL, allowNull: true },
    },
    {
      sequelize,
      modelName: 'TradingPosition',
      tableName: 'trading_positions',
      indexes: [{ fields: ['accountId'] }],
    }
  );
}
