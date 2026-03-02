import { DataTypes, Model, Sequelize } from 'sequelize';

export class RiskCalculation extends Model {
  declare id: string;
  declare userId: string;
  declare chatSessionId: string | null;
  declare messageId: string | null;
  declare correlationId: string | null;
  declare params: object;
  declare result: object;
}

export function initRiskCalculation(sequelize: Sequelize) {
  RiskCalculation.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      chatSessionId: { type: DataTypes.UUID, allowNull: true },
      messageId: { type: DataTypes.UUID, allowNull: true },
      correlationId: { type: DataTypes.STRING, allowNull: true },
      params: { type: DataTypes.JSONB, allowNull: false },
      result: { type: DataTypes.JSONB, allowNull: false }
    },
    { sequelize, modelName: 'RiskCalculation', tableName: 'risk_calculations' }
  );
}

