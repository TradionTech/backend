import { Sequelize } from 'sequelize';
import { env } from '../config/env.js';
import { initUser } from './models/User.js';
import { initChatSession } from './models/ChatSession.js';
import { initChatMessage } from './models/ChatMessage.js';
import { initRiskCalculation } from './models/RiskCalculation.js';
import { initJournalEntry } from './models/JournalEntry.js';
import { initSentimentScore } from './models/SentimentScore.js';
import { initPayment } from './models/Payment.js';
import { initSubscription } from './models/Subscription.js';
import { initUsageStat } from './models/UsageStat.js';
import { initMetaApiAccount } from './models/MetaApiAccount.js';
import { initTradingPosition } from './models/TradingPosition.js';
import { initTradeHistory } from './models/TradeHistory.js';
import { initAccountEquitySnapshot } from './models/AccountEquitySnapshot.js';
import { initUserProfileMetrics } from './models/UserProfileMetrics.js';
import { initChartUpload } from './models/ChartUpload.js';

export const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  define: {
    underscored: true, // Use snake_case for column names
    timestamps: true, // Enable created_at and updated_at
  },
});

export async function initSequelize() {
  initUser(sequelize);
  initChatSession(sequelize);
  initChatMessage(sequelize);
  initRiskCalculation(sequelize);
  initJournalEntry(sequelize);
  initSentimentScore(sequelize);
  initPayment(sequelize);
  initSubscription(sequelize);
  initUsageStat(sequelize);
  initMetaApiAccount(sequelize);
  initTradingPosition(sequelize);
  initTradeHistory(sequelize);
  initAccountEquitySnapshot(sequelize);
  initUserProfileMetrics(sequelize);
  initChartUpload(sequelize);

  // Associations
  const {
    User,
    MetaApiAccount,
    TradingPosition,
    TradeHistory,
    AccountEquitySnapshot,
    UserProfileMetrics,
    ChartUpload,
  } = sequelize.models as any;
  const {
    ChatSession,
    ChatMessage,
    RiskCalculation,
    JournalEntry,
    SentimentScore,
    Payment,
    Subscription,
    UsageStat,
  } = sequelize.models as any;

  User.hasMany(ChatSession, { foreignKey: 'userId' });
  ChatSession.belongsTo(User, { foreignKey: 'userId' });

  ChatSession.hasMany(ChatMessage, { foreignKey: 'sessionId' });
  ChatMessage.belongsTo(ChatSession, { foreignKey: 'sessionId' });

  User.hasMany(RiskCalculation, { foreignKey: 'userId' });
  RiskCalculation.belongsTo(User, { foreignKey: 'userId' });

  User.hasMany(JournalEntry, { foreignKey: 'userId' });
  JournalEntry.belongsTo(User, { foreignKey: 'userId' });

  User.hasMany(SentimentScore, { foreignKey: 'userId' });
  SentimentScore.belongsTo(User, { foreignKey: 'userId' });

  User.hasMany(Payment, { foreignKey: 'userId' });
  Payment.belongsTo(User, { foreignKey: 'userId' });

  User.hasOne(Subscription, { foreignKey: 'userId' });
  Subscription.belongsTo(User, { foreignKey: 'userId' });

  User.hasOne(UsageStat, { foreignKey: 'userId' });
  UsageStat.belongsTo(User, { foreignKey: 'userId' });

  User.hasOne(UserProfileMetrics, { foreignKey: 'userId' });
  UserProfileMetrics.belongsTo(User, { foreignKey: 'userId' });

  User.hasMany(ChartUpload, { foreignKey: 'userId' });
  ChartUpload.belongsTo(User, { foreignKey: 'userId' });

  // MetaAPI Accounts and trading data associations
  User.hasMany(MetaApiAccount, { foreignKey: 'userId' });
  MetaApiAccount.belongsTo(User, { foreignKey: 'userId' });

  MetaApiAccount.hasMany(TradingPosition, { foreignKey: 'accountId' });
  TradingPosition.belongsTo(MetaApiAccount, { foreignKey: 'accountId' });

  MetaApiAccount.hasMany(TradeHistory, { foreignKey: 'accountId' });
  TradeHistory.belongsTo(MetaApiAccount, { foreignKey: 'accountId' });

  MetaApiAccount.hasMany(AccountEquitySnapshot, { foreignKey: 'accountId' });
  AccountEquitySnapshot.belongsTo(MetaApiAccount, { foreignKey: 'accountId' });

  if (process.argv.includes('--sync')) {
    await sequelize.sync({ alter: true });
    console.log('Database synced');
  } else {
    await sequelize.authenticate();
  }
}
