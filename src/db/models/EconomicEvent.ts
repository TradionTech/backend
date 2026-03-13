import { DataTypes, Model, Sequelize } from 'sequelize';

export class EconomicEvent extends Model {
  declare id: string;
  declare eventId: string;
  declare name: string;
  declare countryCode: string;
  declare currencyCode: string;
  declare dateUtc: Date;
  declare periodType: string | null;
  declare volatility: string;
  declare actual: string | null;
  declare revised: string | null;
  declare consensus: string | null;
  declare previousValue: string | null;
  declare unit: string | null;
  declare categoryId: string | null;
  declare isBetterThanExpected: boolean | null;
  declare raw: object | null;
  declare lastUpdated: string | null;
}

export function initEconomicEvent(sequelize: Sequelize) {
  EconomicEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      eventId: { type: DataTypes.STRING, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      countryCode: { type: DataTypes.STRING(10), allowNull: false },
      currencyCode: { type: DataTypes.STRING(10), allowNull: false },
      dateUtc: { type: DataTypes.DATE, allowNull: false },
      periodType: { type: DataTypes.STRING, allowNull: true },
      volatility: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'NONE',
      },
      actual: { type: DataTypes.TEXT, allowNull: true },
      revised: { type: DataTypes.TEXT, allowNull: true },
      consensus: { type: DataTypes.TEXT, allowNull: true },
      previousValue: { type: DataTypes.TEXT, allowNull: true },
      unit: { type: DataTypes.STRING, allowNull: true },
      categoryId: { type: DataTypes.STRING, allowNull: true },
      isBetterThanExpected: { type: DataTypes.BOOLEAN, allowNull: true },
      raw: { type: DataTypes.JSONB, allowNull: true },
      lastUpdated: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, modelName: 'EconomicEvent', tableName: 'economic_events' }
  );
}
