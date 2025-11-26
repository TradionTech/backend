import { DataTypes, Model, Sequelize } from 'sequelize';

export class SentimentScore extends Model {
  declare id: string;
  declare userId: string | null; // optional, global sentiment if null
  declare symbol: string;
  declare score: number;
  declare trend: 'bullish' | 'bearish' | 'neutral';
  declare drivers: object | null;
  declare timestamp: Date;
}

export function initSentimentScore(sequelize: Sequelize) {
  SentimentScore.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: true },
      symbol: { type: DataTypes.STRING, allowNull: false },
      score: { type: DataTypes.FLOAT, allowNull: false },
      trend: { type: DataTypes.ENUM('bullish', 'bearish', 'neutral'), allowNull: false },
      drivers: { type: DataTypes.JSONB, allowNull: true },
      timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    { sequelize, modelName: 'SentimentScore', tableName: 'sentiment_scores' }
  );
}

