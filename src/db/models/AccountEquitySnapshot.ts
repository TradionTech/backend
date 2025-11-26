import { DataTypes, Model, Sequelize } from 'sequelize';

export class AccountEquitySnapshot extends Model {
  declare id: number;
  declare accountId: number;
  declare balance: number | null;
  declare equity: number | null;
  declare margin: number | null;
  declare freeMargin: number | null;
  declare currency: string | null;
  declare takenAt: Date;
}

export function initAccountEquitySnapshot(sequelize: Sequelize) {
  AccountEquitySnapshot.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      accountId: { type: DataTypes.BIGINT, allowNull: false },
      balance: { type: DataTypes.DECIMAL, allowNull: true },
      equity: { type: DataTypes.DECIMAL, allowNull: true },
      margin: { type: DataTypes.DECIMAL, allowNull: true },
      freeMargin: { type: DataTypes.DECIMAL, allowNull: true },
      currency: { type: DataTypes.STRING, allowNull: true },
      takenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'AccountEquitySnapshot',
      tableName: 'account_equity_snapshots',
      indexes: [{ fields: ['accountId', 'takenAt'] }],
    }
  );
}
