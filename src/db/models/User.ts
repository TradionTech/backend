import { DataTypes, Model, Sequelize } from 'sequelize';

export class User extends Model {
  declare id: string; // Clerk user id
  declare email: string | null;
  declare plan: 'free' | 'pro';
  declare proExpiry: Date | null; // if one-time time-limited
}

export function initUser(sequelize: Sequelize) {
  User.init(
    {
      id: { type: DataTypes.STRING, primaryKey: true }, // Clerk user id as PK
      email: { type: DataTypes.STRING, allowNull: true },
      plan: { type: DataTypes.ENUM('free', 'pro'), defaultValue: 'free' },
      proExpiry: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'User', tableName: 'users' }
  );
}

