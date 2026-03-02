import { DataTypes, Model, Sequelize } from 'sequelize';

export class ChartUpload extends Model {
  declare id: string; // UUID
  declare userId: string; // FK → User.id
  declare storageKey: string; // S3/R2 key
  declare originalFilename: string;
  declare mimeType: string;
  declare sizeBytes: number;
  declare symbolHint: string | null;
  declare timeframeHint: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initChartUpload(sequelize: Sequelize) {
  ChartUpload.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      storageKey: { type: DataTypes.STRING, allowNull: false },
      originalFilename: { type: DataTypes.STRING, allowNull: false },
      mimeType: { type: DataTypes.STRING, allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
      symbolHint: { type: DataTypes.STRING, allowNull: true },
      timeframeHint: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, modelName: 'ChartUpload', tableName: 'chart_uploads' }
  );
}
