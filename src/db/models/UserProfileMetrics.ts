import { DataTypes, Model, Sequelize } from 'sequelize';

export class UserProfileMetrics extends Model {
  declare id: number;
  declare userId: string;
  declare typicalRiskPerTradePct: number;
  declare typicalPositionSizeUsd: number;
  declare avgRrRatio: number | null;
  declare maxDrawdownPct: number | null;
  declare lastComputedAt: Date;
}

export function initUserProfileMetrics(sequelize: Sequelize) {
  UserProfileMetrics.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false, unique: true },
      typicalRiskPerTradePct: { type: DataTypes.DECIMAL, allowNull: false },
      typicalPositionSizeUsd: { type: DataTypes.DECIMAL, allowNull: false },
      avgRrRatio: { type: DataTypes.DECIMAL, allowNull: true },
      maxDrawdownPct: { type: DataTypes.DECIMAL, allowNull: true },
      lastComputedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'UserProfileMetrics',
      tableName: 'user_profile_metrics',
      indexes: [{ fields: ['userId'] }],
    }
  );
}
