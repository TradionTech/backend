import { DataTypes, Model, Sequelize } from 'sequelize';

export class UsageStat extends Model {
  declare id: string;
  declare userId: string;
  declare chatToday: number;
  declare analysesToday: number;
  declare lastResetAt: Date;
}

export function initUsageStat(sequelize: Sequelize) {
  UsageStat.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false, unique: true },
      chatToday: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      analysesToday: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastResetAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    { sequelize, modelName: 'UsageStat', tableName: 'usage_stats' }
  );
}

