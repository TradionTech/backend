import { DataTypes, Model, Sequelize } from 'sequelize';

export class ChatSession extends Model {
  declare id: string;
  declare userId: string;
  declare context: object | null; // last 3 messages
}

export function initChatSession(sequelize: Sequelize) {
  ChatSession.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      context: { type: DataTypes.JSONB, allowNull: true }
    },
    { sequelize, modelName: 'ChatSession', tableName: 'chat_sessions' }
  );
}

