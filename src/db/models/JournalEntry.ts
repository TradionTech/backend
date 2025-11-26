import { DataTypes, Model, Sequelize } from 'sequelize';

export class JournalEntry extends Model {
  declare id: string;
  declare userId: string;
  declare symbol: string;
  declare direction: 'LONG' | 'SHORT';
  declare entryPrice: number;
  declare exitPrice: number | null;
  declare notes: string | null;
  declare aiFeedback: object | null;
}

export function initJournalEntry(sequelize: Sequelize) {
  JournalEntry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      symbol: { type: DataTypes.STRING, allowNull: false },
      direction: { type: DataTypes.ENUM('LONG', 'SHORT'), allowNull: false },
      entryPrice: { type: DataTypes.FLOAT, allowNull: false },
      exitPrice: { type: DataTypes.FLOAT, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      aiFeedback: { type: DataTypes.JSONB, allowNull: true }
    },
    { sequelize, modelName: 'JournalEntry', tableName: 'journal_entries' }
  );
}

