import { DataTypes, Model, Sequelize } from 'sequelize';

export class RiskCalculation extends Model {
  declare id: string;
  declare userId: string;
  declare params: object;
  declare result: object;
}

export function initRiskCalculation(sequelize: Sequelize) {
  RiskCalculation.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      params: { type: DataTypes.JSONB, allowNull: false },
      result: { type: DataTypes.JSONB, allowNull: false }
    },
    { sequelize, modelName: 'RiskCalculation', tableName: 'risk_calculations' }
  );
}

