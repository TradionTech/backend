import { DataTypes, Model, Sequelize } from 'sequelize';

export class Subscription extends Model {
  declare id: string;
  declare userId: string;
  declare provider: 'paystack';
  declare plan: 'pro';
  declare status: 'active' | 'canceled' | 'past_due';
  declare providerSubCode: string | null; // Paystack subscription_code
  declare authCode: string | null; // Paystack card authorization code
  declare currentPeriodEnd: Date | null;
}

export function initSubscription(sequelize: Sequelize) {
  Subscription.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false, unique: true },
      provider: { type: DataTypes.ENUM('paystack'), allowNull: false, defaultValue: 'paystack' },
      plan: { type: DataTypes.ENUM('pro'), allowNull: false, defaultValue: 'pro' },
      status: { type: DataTypes.ENUM('active', 'canceled', 'past_due'), allowNull: false, defaultValue: 'active' },
      providerSubCode: { type: DataTypes.STRING, allowNull: true },
      authCode: { type: DataTypes.STRING, allowNull: true },
      currentPeriodEnd: { type: DataTypes.DATE, allowNull: true }
    },
    { sequelize, modelName: 'Subscription', tableName: 'subscriptions' }
  );
}

