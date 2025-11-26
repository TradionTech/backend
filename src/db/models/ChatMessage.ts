import { DataTypes, Model, Sequelize } from 'sequelize';

export class ChatMessage extends Model {
  declare id: string;
  declare sessionId: string;
  declare role: 'user' | 'assistant' | 'system';
  declare content: string;
}

export function initChatMessage(sequelize: Sequelize) {
  ChatMessage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      role: { type: DataTypes.ENUM('user', 'assistant', 'system'), allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false }
    },
    { sequelize, modelName: 'ChatMessage', tableName: 'chat_messages' }
  );
}

