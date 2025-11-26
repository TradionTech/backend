import { DataTypes, Model, Sequelize } from 'sequelize';

export class Payment extends Model {
  declare id: string;
  declare userId: string;
  declare provider: 'paystack';
  declare reference: string;
  declare amount: number; // kobo
  declare currency: string; // NGN
  declare status: 'pending' | 'success' | 'failed';
  declare meta: object | null;
}

export function initPayment(sequelize: Sequelize) {
  Payment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      provider: { type: DataTypes.ENUM('paystack'), allowNull: false, defaultValue: 'paystack' },
      reference: { type: DataTypes.STRING, allowNull: false, unique: true },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'NGN' },
      status: { type: DataTypes.ENUM('pending', 'success', 'failed'), allowNull: false, defaultValue: 'pending' },
      meta: { type: DataTypes.JSONB, allowNull: true }
    },
    { sequelize, modelName: 'Payment', tableName: 'payments' }
  );
}

