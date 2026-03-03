import crypto from 'crypto';
import MetaApi from 'metaapi.cloud-sdk/esm-node';
import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { MetaApiMetatraderDeal, MetaApiMetatraderOrder } from '../../types/metaapi';
import type { TradeHistory } from '../../db/models/TradeHistory';

const metaApi = new MetaApi(env.METAAPI_TOKEN || '');

/** Provisioning API (account management) is global. See https://metaapi.cloud/docs/provisioning/api/account/ */
const METAAPI_PROVISIONING_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

/**
 * MetaAPI provisioning API account model (state, connectionStatus, etc.).
 * See https://metaapi.cloud/docs/provisioning/models/tradingAccount/
 */
export interface MetaApiProvisioningAccount {
  _id: string;
  state: string;
  connectionStatus: string;
  region?: string;
  name?: string;
  login?: string;
  server?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Get MetaApi REST API base URL for a given region (terminal state API).
 * Defaults to 'new-york' if region is not provided.
 * See https://mt-client-api-v1.new-york.agiliumtrade.ai/swagger/
 */
function getMetaApiRestBaseUrl(region: string | null): string {
  const regionSlug = region?.toLowerCase().replace(/_/g, '-') || 'new-york';
  return `https://mt-client-api-v1.${regionSlug}.agiliumtrade.ai`;
}

/**
 * Create authenticated HTTP client for MetaApi terminal state REST API (mt-client-api).
 */
function createMetaApiRestClient(region: string | null): AxiosInstance {
  const baseURL = getMetaApiRestBaseUrl(region);
  return axios.create({
    baseURL,
    headers: {
      'auth-token': env.METAAPI_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Create authenticated HTTP client for MetaApi provisioning REST API (account management).
 */
function createProvisioningClient(): AxiosInstance {
  return axios.create({
    baseURL: METAAPI_PROVISIONING_BASE,
    headers: {
      'auth-token': env.METAAPI_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Fetch account from MetaAPI provisioning API (state, connectionStatus, region, etc.).
 * Use this to sync state to DB without deploying the account.
 */
export async function getAccountFromProvisioningApi(
  accountId: string
): Promise<MetaApiProvisioningAccount | null> {
  try {
    const client = createProvisioningClient();
    const { data } = await client.get<MetaApiProvisioningAccount>(
      `/users/current/accounts/${accountId}`
    );
    return data;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    logger.warn('MetaAPI provisioning getAccount failed', {
      accountId,
      err: err?.message,
      status: err?.response?.status,
    });
    throw err;
  }
}

/**
 * List all trading accounts from MetaAPI provisioning API (GET /users/current/accounts).
 * See https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/swagger/#!/default/get_users_current_accounts
 */
export async function listAccountsFromProvisioningApi(): Promise<MetaApiProvisioningAccount[]> {
  try {
    const client = createProvisioningClient();
    const { data } = await client.get<MetaApiProvisioningAccount[] | { items?: MetaApiProvisioningAccount[] }>(
      '/users/current/accounts'
    );
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray((data as { items?: MetaApiProvisioningAccount[] }).items)) {
      return (data as { items: MetaApiProvisioningAccount[] }).items;
    }
    return [];
  } catch (err: any) {
    logger.warn('MetaAPI provisioning listAccounts failed', {
      err: err?.message,
      status: err?.response?.status,
    });
    throw err;
  }
}

/**
 * Find an existing MetaAPI account by login and server (case-sensitive match after trim).
 * Returns the account from MetaAPI if found, null otherwise.
 */
export async function findMetaApiAccountByLoginAndServer(
  login: string,
  server: string
): Promise<MetaApiProvisioningAccount | null> {
  const normalizedLogin = login.trim();
  const normalizedServer = server.trim();
  const accounts = await listAccountsFromProvisioningApi();
  const found = accounts.find(
    (a) =>
      (a.login ?? '').trim() === normalizedLogin &&
      (a.server ?? '').trim() === normalizedServer
  );
  return found ?? null;
}

/**
 * Deploy a MetaAPI account (starts API server and trading terminal).
 * No-op if account is already deployed. See https://metaapi.cloud/docs/provisioning/api/account/deployAccount/
 */
export async function deployAccountViaProvisioningApi(accountId: string): Promise<void> {
  const client = createProvisioningClient();
  await client.post(`/users/current/accounts/${accountId}/deploy`);
}

/** Body for MetaAPI create account. See https://metaapi.cloud/docs/provisioning/api/account/createAccount/ */
export interface CreateMetaApiAccountBody {
  login: string;
  password: string;
  name: string;
  server: string;
  platform: 'mt4' | 'mt5';
  magic: number;
  region?: string;
  type?: 'cloud-g1' | 'cloud-g2';
  provisioningProfileId?: string;
  keywords?: string[];
  manualTrades?: boolean;
  resourceSlots?: number;
  [key: string]: unknown;
}

/** Response from create account: 201 with id and state; or 202 with retry info */
export interface CreateMetaApiAccountResult {
  id: string;
  state: string;
}

/**
 * Create a trading account in MetaAPI (provision). Uses transaction-id for idempotency/retry.
 * Returns the created account id and state on 201; on 202 returns retry_after so client can retry with same transaction_id.
 */
export async function createAccountViaProvisioningApi(
  body: CreateMetaApiAccountBody,
  transactionId?: string
): Promise<
  | { status: 'created'; id: string; state: string }
  | { status: 'accepted'; transactionId: string; retryAfterSeconds: number; message?: string }
> {
  const txId = transactionId ?? crypto.randomBytes(16).toString('hex');
  const client = createProvisioningClient();
  const response = await client.post<CreateMetaApiAccountResult | { message?: string }>(
    '/users/current/accounts',
    {
      login: body.login,
      password: body.password,
      name: body.name,
      server: body.server,
      platform: body.platform,
      magic: body.magic,
      ...(body.region != null && { region: body.region }),
      ...(body.type != null && { type: body.type }),
      ...(body.provisioningProfileId != null && {
        provisioningProfileId: body.provisioningProfileId,
      }),
      ...(body.keywords != null && body.keywords.length > 0 && { keywords: body.keywords }),
      ...(body.manualTrades != null && { manualTrades: body.manualTrades }),
      ...(body.resourceSlots != null && { resourceSlots: body.resourceSlots }),
    },
    {
      headers: { 'transaction-id': txId },
      validateStatus: (s) => s === 201 || s === 202,
    }
  );

  if (response.status === 201 && response.data && 'id' in response.data) {
    return {
      status: 'created',
      id: response.data.id,
      state: response.data.state,
    };
  }

  const retryAfter = response.headers['retry-after'];
  const seconds = typeof retryAfter === 'string' ? parseInt(retryAfter, 10) : 60;
  return {
    status: 'accepted',
    transactionId: txId,
    retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
    message: (response.data as { message?: string })?.message,
  };
}

/**
 * Sync MetaAPI account state (state, connectionStatus, region, name, etc.) to the database.
 * Call this on link, on a schedule, or before showing account status. Does not deploy the account.
 */
export async function syncAccountStateToDb(metaapiAccountId: string): Promise<boolean> {
  const provisioning = await getAccountFromProvisioningApi(metaapiAccountId);
  if (!provisioning) {
    logger.warn('MetaAPI account not found', { metaapiAccountId: metaapiAccountId });
    return false;
  }
  const { MetaApiAccount } = await import('../../db/models/MetaApiAccount');
  const row = await MetaApiAccount.findOne({
    where: { metaapiAccountId },
  });
  if (!row) return false;
  await row.update({
    state: provisioning.state ?? null,
    connectionStatus: provisioning.connectionStatus ?? null,
    region: provisioning.region ?? row.region,
    name: provisioning.name ?? row.name,
    login: provisioning.login ?? null,
    server: provisioning.server ?? null,
    accountType: provisioning.type ?? null,
  });
  return true;
}

/**
 * Ensure account is deployed and connected so terminal-state APIs (balance, positions, history) work.
 * If state is UNDEPLOYED, deploys via SDK; then waits until connectionStatus is CONNECTED.
 * See https://metaapi.cloud/docs/provisioning/api/account/deployAccount/ and TradingAccount state/connectionStatus.
 */
async function ensureConnected(accountId: string) {
  const account = await metaApi.metatraderAccountApi.getAccount(accountId);
  if (!account) throw new Error('MetaAPI account not found');
  if (account.state !== 'DEPLOYED') {
    await account.deploy();
  }
  await account.waitConnected();
  return account;
}

export async function getAccountSummary(metaapiAccountId: string) {
  const account = await ensureConnected(metaapiAccountId);
  const connection = account.getRPCConnection();
  await connection.connect();
  const [accountInfo, positions] = await Promise.all([
    connection.getAccountInformation(),
    connection.getPositions(),
  ]);
  return { accountInfo, positions };
}

export async function getOpenPositions(metaapiAccountId: string) {
  const account = await ensureConnected(metaapiAccountId);
  const connection = account.getRPCConnection();
  await connection.connect();
  return connection.getPositions();
}

export async function getHistory(metaapiAccountId: string, from?: Date, to?: Date) {
  const account = await ensureConnected(metaapiAccountId);
  const connection = account.getRPCConnection();
  await connection.connect();
  const start = from ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const end = to ?? new Date();
  return connection.getHistoryOrdersByTimeRange(start, end);
}

export async function getBalance(metaapiAccountId: string) {
  try {
    const account = await ensureConnected(metaapiAccountId);
    const connection = account.getRPCConnection();
    await connection.connect();
    const info = await connection.getAccountInformation();
    return { balance: info.balance, equity: info.equity, currency: info.currency };
  } catch (err: any) {
    logger.error('MetaAPI balance error', { err: err?.message });
    throw err;
  }
}

/**
 * Get account region from database MetaApiAccount record
 * Returns the region string or null if not available
 */
async function getAccountRegion(metaapiAccountId: string): Promise<string | null> {
  try {
    const { MetaApiAccount } = await import('../../db/models/MetaApiAccount');
    const account = await MetaApiAccount.findOne({
      where: { metaapiAccountId },
    });
    return account?.region || null;
  } catch (err: any) {
    logger.warn('Could not get account region from database', { err: err?.message });
    return null;
  }
}

/**
 * Get history deals by position ID using MetaApi REST API
 *
 * @param metaapiAccountId - MetaApi account ID
 * @param positionId - MetaTrader position ID
 * @returns Array of MetatraderDeal objects
 */
export async function getHistoryDealsByPosition(
  metaapiAccountId: string,
  positionId: string
): Promise<MetaApiMetatraderDeal[]> {
  try {
    await ensureConnected(metaapiAccountId);
    const region = await getAccountRegion(metaapiAccountId);
    const client = createMetaApiRestClient(region);

    const response = await client.get<MetaApiMetatraderDeal[]>(
      `/users/current/accounts/${metaapiAccountId}/history-deals/position/${positionId}`
    );

    return response.data;
  } catch (err: any) {
    logger.error('MetaAPI getHistoryDealsByPosition error', {
      metaapiAccountId,
      positionId,
      err: err?.message,
      response: err?.response?.data,
    });
    throw new Error(`Failed to get history deals: ${err?.message || 'Unknown error'}`);
  }
}

/**
 * Get history orders by position ID using MetaApi REST API
 *
 * @param metaapiAccountId - MetaApi account ID
 * @param positionId - MetaTrader position ID
 * @returns Array of MetatraderOrder objects
 */
export async function getHistoryOrdersByPosition(
  metaapiAccountId: string,
  positionId: string
): Promise<MetaApiMetatraderOrder[]> {
  try {
    await ensureConnected(metaapiAccountId);
    const region = await getAccountRegion(metaapiAccountId);
    const client = createMetaApiRestClient(region);

    const response = await client.get<MetaApiMetatraderOrder[]>(
      `/users/current/accounts/${metaapiAccountId}/history-orders/position/${positionId}`
    );

    return response.data;
  } catch (err: any) {
    logger.error('MetaAPI getHistoryOrdersByPosition error', {
      metaapiAccountId,
      positionId,
      err: err?.message,
      response: err?.response?.data,
    });
    throw new Error(`Failed to get history orders: ${err?.message || 'Unknown error'}`);
  }
}

/**
 * Parse ISO 8601 time string to Date object
 * Returns null if parsing fails or input is undefined
 */
function parseIsoTime(time: string | undefined): Date | null {
  if (!time) return null;
  try {
    const date = new Date(time);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Map MetaApi MetatraderDeal to TradeHistory attributes
 *
 * Preserves all MetaApi fields and converts ISO time strings to Date objects.
 * Maps deal.id to metaapiDealId, deal.type to dealType.
 *
 * @param deal - MetaApi deal object
 * @param accountId - Internal account ID (number FK to MetaApiAccount)
 * @returns Partial TradeHistory attributes ready for DB insertion
 */
export function mapMetaApiDealToTradeHistory(
  deal: MetaApiMetatraderDeal,
  accountId: number
): Partial<TradeHistory> {
  const time = parseIsoTime(deal.time);

  return {
    accountId,
    // MetaApi identifiers
    metaapiDealId: deal.id,
    positionId: deal.positionId || null,
    orderId: deal.orderId || null,
    dealId: deal.id, // Keep for backward compatibility

    // Core trade fields
    symbol: deal.symbol || null,
    type: deal.type, // Store deal type in type field for backward compat
    dealType: deal.type, // Also store in dealType field
    volume: deal.volume ?? null,
    price: deal.price ?? null,

    // Financial fields
    profit: deal.profit ?? null,
    commission: deal.commission ?? null,
    swap: deal.swap ?? null,

    // Time fields
    time: time, // Canonical MetaApi time (ISO converted to Date)
    timeOpen: time, // Map to timeOpen for backward compatibility
    brokerTime: deal.brokerTime || null,

    // MetaApi-specific fields
    magic: deal.magic ?? null,
    platform: deal.platform || null,
    entryType: deal.entryType || null,
    clientId: deal.clientId || null,
    comment: deal.comment || null,
    brokerComment: deal.brokerComment || null,
    reason: deal.reason || null,
    accountCurrencyExchangeRate: deal.accountCurrencyExchangeRate ?? null,
    stopLoss: deal.stopLoss ?? null,
    takeProfit: deal.takeProfit ?? null,
  };
}

/**
 * Map MetaApi MetatraderOrder to TradeHistory attributes
 *
 * Preserves all MetaApi fields and converts ISO time strings to Date objects.
 * Maps order.id to metaapiOrderId, order.type to type, order.state to orderState.
 *
 * @param order - MetaApi order object
 * @param accountId - Internal account ID (number FK to MetaApiAccount)
 * @returns Partial TradeHistory attributes ready for DB insertion
 */
export function mapMetaApiOrderToTradeHistory(
  order: MetaApiMetatraderOrder,
  accountId: number
): Partial<TradeHistory> {
  const time = parseIsoTime(order.time);
  const doneTime = parseIsoTime(order.doneTime);

  return {
    accountId,
    // MetaApi identifiers
    metaapiOrderId: order.id,
    positionId: order.positionId || null,
    orderId: order.id, // Keep for backward compatibility

    // Core trade fields
    symbol: order.symbol || null,
    type: order.type, // Order type enum
    orderState: order.state, // Order state enum
    volume: order.volume ?? null,
    currentVolume: order.currentVolume ?? null,
    price: order.openPrice ?? order.currentPrice ?? null,

    // Time fields
    time: time, // Canonical MetaApi time (ISO converted to Date)
    timeOpen: time, // Map to timeOpen for backward compatibility
    doneTime: doneTime, // Order completion time
    brokerTime: order.brokerTime || null,
    doneBrokerTime: order.doneBrokerTime || null,

    // MetaApi-specific fields
    magic: order.magic ?? null,
    platform: order.platform || null,
    clientId: order.clientId || null,
    comment: order.comment || null,
    brokerComment: order.brokerComment || null,
    reason: order.reason || null,
    stopLoss: order.stopLoss ?? null,
    takeProfit: order.takeProfit ?? null,
    stopLimitPrice: order.stopLimitPrice ?? null,
    trailingStopLoss: order.trailingStopLoss || null,
  };
}
