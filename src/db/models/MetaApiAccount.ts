import { DataTypes, Model, Sequelize } from 'sequelize';

export class MetaApiAccount extends Model {
  declare id: number;
  declare userId: string;
  declare metaapiAccountId: string;
  declare name: string | null;
  declare platform: 'mt4' | 'mt5' | null;
  declare region: string | null;
  /** MetaAPI deployment state: DEPLOYED, UNDEPLOYED, DEPLOYING, etc. */
  declare state: string | null;
  /** Terminal connection: CONNECTED, DISCONNECTED, DISCONNECTED_FROM_BROKER */
  declare connectionStatus: string | null;
  declare login: string | null;
  declare server: string | null;
  /** Account type from MetaAPI e.g. cloud-g2 */
  declare accountType: string | null;
  declare isActive: boolean;
  declare connectedAt: Date | null;
  declare lastSyncedAt: Date | null;
}

export function initMetaApiAccount(sequelize: Sequelize) {
  MetaApiAccount.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.STRING, allowNull: false },
      metaapiAccountId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: true },
      platform: { type: DataTypes.ENUM('mt4', 'mt5'), allowNull: true },
      region: { type: DataTypes.STRING, allowNull: true },
      state: { type: DataTypes.STRING, allowNull: true },
      connectionStatus: { type: DataTypes.STRING, allowNull: true },
      login: { type: DataTypes.STRING, allowNull: true },
      server: { type: DataTypes.STRING, allowNull: true },
      accountType: { type: DataTypes.STRING, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      connectedAt: { type: DataTypes.DATE, allowNull: true },
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'MetaApiAccount',
      tableName: 'metaapi_accounts',
      indexes: [{ fields: ['userId'] }],
    }
  );
}
