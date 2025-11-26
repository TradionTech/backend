import MetaApi from 'metaapi.cloud-sdk/esm-node';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const metaApi = new MetaApi(env.METAAPI_TOKEN || '');

async function ensureConnected(accountId: string) {
  const account = await metaApi.metatraderAccountApi.getAccount(accountId);
  if (!account) throw new Error('MetaAPI account not found');
  // Deploy and wait until connected
  if (account.state !== 'DEPLOYED') {
    await account.deploy();
  }
  await account.waitConnected();
  return account;
}

export async function getAccountSummary(metaapiAccountId: string) {
  const account = await ensureConnected(metaapiAccountId);
  const connection = account.getRPCMetaApiConnection();
  await connection.connect();
  const [accountInfo, positions] = await Promise.all([
    connection.getAccountInformation(),
    connection.getPositions(),
  ]);
  return { accountInfo, positions };
}

export async function getOpenPositions(metaapiAccountId: string) {
  const account = await ensureConnected(metaapiAccountId);
  const connection = account.getRPCMetaApiConnection();
  await connection.connect();
  return connection.getPositions();
}

export async function getHistory(metaapiAccountId: string, from?: Date, to?: Date) {
  const account = await ensureConnected(metaapiAccountId);
  const connection = account.getRPCMetaApiConnection();
  await connection.connect();
  const start = from ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const end = to ?? new Date();
  return connection.getHistoryOrdersByTimeRange(start, end);
}

export async function getBalance(metaapiAccountId: string) {
  try {
    const account = await ensureConnected(metaapiAccountId);
    const connection = account.getRPCMetaApiConnection();
    await connection.connect();
    const info = await connection.getAccountInformation();
    return { balance: info.balance, equity: info.equity, currency: info.currency };
  } catch (err: any) {
    logger.error('MetaAPI balance error', { err: err?.message });
    throw err;
  }
}
