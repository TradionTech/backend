import { DataTypes, Model, Sequelize } from 'sequelize';

/**
 * Session metadata structure stored in the context field:
 * {
 *   user_level?: "novice" | "intermediate" | "advanced",
 *   last_intent?: string,
 *   market_context?: object // for future market data integration
 * }
 */
export class ChatSession extends Model {
  declare id: string;
  declare userId: string;
  declare context: object | null; // Structured metadata (see above)
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

