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
 * MetaAPI provisioning API error response (400, 401, 403, 404).
 * See https://metaapi.cloud/docs/provisioning/api/account/createAccount/#errors
 */
export interface MetaApiProvisioningErrorBody {
  id?: number;
  error?: string;
  message?: string;
  details?: string | { code?: string; recommendedResourceSlots?: number; serversByBrokers?: Record<string, string[]> };
}

/** Structured error thrown when provisioning/linking fails (from MetaAPI or network). */
export class MetaApiProvisioningError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: MetaApiProvisioningErrorBody['details']
  ) {
    super(message);
    this.name = 'MetaApiProvisioningError';
  }
}

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
    const status = err?.response?.status;
    const data = err?.response?.data as MetaApiProvisioningErrorBody | undefined;
    if (status === 404) return null;
    const message = data?.message ?? err?.message ?? 'Failed to get account';
    const details = data?.details;
    const code =
      typeof details === 'object' && details !== null && 'code' in details
        ? (details as { code?: string }).code
        : typeof details === 'string'
          ? details
          : undefined;
    if (status >= 400 && status <= 499) {
      throw new MetaApiProvisioningError(message, status, code, details);
    }
    logger.warn('MetaAPI provisioning getAccount failed', {
      accountId,
      err: err?.message,
      status,
    });
    throw new MetaApiProvisioningError(message, status ?? 500, code, details);
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
export interface CreateMetaApiResult {
  id: string;
  state: string;
}
export async function createAccountViaProvisioningApi(
  body: CreateMetaApiAccountBody,
  transactionId?: string
): Promise<
  | { status: 'created'; id: string; state: string }
  | { status: 'accepted'; transactionId: string; retryAfterSeconds: number; message?: string }
> {
  const txId = transactionId ?? crypto.randomBytes(16).toString('hex');
  const client = createProvisioningClient();
  try {
    const response = await client.post<CreateMetaApiResult | { message?: string }>(
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
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data as MetaApiProvisioningErrorBody | undefined;
    const message = data?.message ?? err?.message ?? 'Provisioning request failed';
    const details = data?.details;
    const code =
      typeof details === 'object' && details !== null && 'code' in details
        ? (details as { code?: string }).code
        : typeof details === 'string'
          ? details
          : undefined;
    if (status >= 400 && status <= 499) {
      throw new MetaApiProvisioningError(message, status, code, details);
    }
    logger.warn('MetaAPI createAccount failed', { status, code, message });
    throw new MetaApiProvisioningError(message, status ?? 500, code, details);
  }
}

/**
 * Known MT servers response: broker name -> list of server names.
 * GET /known-mt-servers/:version/search?query=...
 */
export interface KnownMtServersResponse {
  [brokerName: string]: string[];
}

/**
 * Fetch known trading servers from MetaAPI for MT4 or MT5 (for server dropdown/search).
 * See https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/swagger/#!/default/get_known_mt_servers_version_search
 */
export async function getKnownMtServers(
  version: 4 | 5,
  query?: string
): Promise<KnownMtServersResponse> {
  const client = createProvisioningClient();
  const params = query != null && query.trim() !== '' ? { query: query.trim() } : {};
  try {
    const response = await client.get<KnownMtServersResponse>(
      `/known-mt-servers/${version}/search`,
      { params }
    );
    return response.data ?? {};
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data as MetaApiProvisioningErrorBody | undefined;
    const message = data?.message ?? err?.message ?? 'Failed to fetch known trading servers';
    const details = data?.details;
    const code =
      typeof details === 'object' && details !== null && 'code' in details
        ? (details as { code?: string }).code
        : typeof details === 'string'
          ? details
          : undefined;
    if (status >= 400 && status <= 499) {
      throw new MetaApiProvisioningError(message, status, code, details);
    }
    throw new MetaApiProvisioningError(message, status ?? 500, code, details);
  }
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
 * Account information from MetaAPI terminal (balance, equity, margin, etc.).
 * See https://metaapi.cloud/docs/client/models/metatraderAccountInformation/
 * and https://mt-client-api-v1.new-york.agiliumtrade.ai/swagger/#!/default/get_users_current_accounts_accountId_account_information
 */
export interface MetaApiAccountInformation {
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  leverage?: number;
  marginLevel?: number;
  tradeAllowed?: boolean;
  currency?: string;
  broker?: string;
  server?: string;
  name?: string;
  login?: number | string;
  marginMode?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Get full account information (balance, equity, margin, etc.) from MetaAPI terminal.
 * Requires account to be deployed and connected. Returns null on failure (e.g. not connected).
 */
export async function getAccountInformation(
  metaapiAccountId: string
): Promise<MetaApiAccountInformation | null> {
  try {
    const account = await ensureConnected(metaapiAccountId);
    const connection = account.getRPCConnection();
    await connection.connect();
    const info = await connection.getAccountInformation();
    return info as MetaApiAccountInformation;
  } catch (err: any) {
    logger.debug('MetaAPI getAccountInformation failed', {
      metaapiAccountId,
      err: err?.message,
    });
    return null;
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
