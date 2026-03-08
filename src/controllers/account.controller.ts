import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import {
  getAccountSummary,
  getOpenPositions,
  getHistory,
  getBalance,
  getAccountInformation,
  syncAccountStateToDb,
  createAccountViaProvisioningApi,
  findMetaApiAccountByLoginAndServer,
  getAccountFromProvisioningApi,
  getKnownMtServers,
  MetaApiProvisioningError,
  type CreateMetaApiAccountBody,
} from '../services/brokers/metaapi';
import { MetaApiAccount } from '../db/models/MetaApiAccount';

async function resolveOwnedMetaapiAccountId(req: Request): Promise<string> {
  const { userId } = getAuth(req);
  if (!userId) {
    throw new Error('Unauthorized');
  }
  const id = Number(req.params.id);
  const rec = await MetaApiAccount.findOne({ where: { id, userId } });
  if (!rec) {
    const err: any = new Error('Account not found');
    err.status = 404;
    throw err;
  }
  return rec.metaapiAccountId as string;
}

/** Map MetaAPI provisioning error code to user-facing message and optional details. */
function mapProvisioningError(
  err: MetaApiProvisioningError
): { status: number; message: string; code: string; details?: Record<string, unknown> } {
  const code = err.code ?? 'UNKNOWN';
  const details: Record<string, unknown> = {};
  if (typeof err.details === 'object' && err.details !== null) {
    if ('serversByBrokers' in err.details && err.details.serversByBrokers) {
      details.suggested_servers = err.details.serversByBrokers;
    }
    if ('recommendedResourceSlots' in err.details && err.details.recommendedResourceSlots != null) {
      details.recommended_resource_slots = err.details.recommendedResourceSlots;
    }
  }
  const messages: Record<string, string> = {
    E_SRV_NOT_FOUND:
      'Trading server name not found. Check the server name or use a provisioning profile. See suggested_servers for similar names.',
    E_AUTH:
      'Invalid login or password, or account disabled at the broker. Check credentials and server.',
    E_SERVER_TIMEZONE:
      'Could not detect broker settings. Try again later or configure a provisioning profile.',
    E_RESOURCE_SLOTS:
      'This account needs more resource slots. Re-submit with recommended_resource_slots.',
    E_NO_SYMBOLS:
      'No symbols configured for this account. Use a different account or contact your broker.',
    ERR_OTP_REQUIRED:
      'One-time password is required. Disable OTP in the mobile MetaTrader app or use a different account.',
    E_PASSWORD_CHANGE_REQUIRED:
      'The broker requires a password change. Change the MT account password and try again.',
    E_TRADING_ACCOUNT_DISABLED:
      'The broker reports this account as disabled. Use a different account or contact your broker.',
  };
  const message = messages[code] ?? err.message ?? 'Account provisioning failed.';
  const status = err.statusCode === 401 ? 401 : err.statusCode === 403 ? 403 : 400;
  return { status, message, code, details: Object.keys(details).length ? details : undefined };
}

export const accountController = {
  // Provision a new MetaAPI account and link it to the current user.
  // 1) If DB already has this login+server: same user → 200 + sync; other user → 409.
  // 2) If not in DB but MetaAPI has it → link to current user, 200 + sync.
  // 3) Else create via MetaAPI (201 or 202).
  provision: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const body = req.body || {};
    const {
      login,
      password,
      name,
      server,
      platform,
      magic,
      region,
      type,
      provisioning_profile_id,
      transaction_id,
    } = body;
    if (!login || !password || !name || !server || !platform || magic == null) {
      return res.status(400).json({
        error:
          'login, password, name, server, platform, and magic are required',
      });
    }
    if (platform !== 'mt4' && platform !== 'mt5') {
      return res.status(400).json({
        error: 'platform must be mt4 or mt5',
      });
    }
    const provisionBody: CreateMetaApiAccountBody = {
      login: String(login).trim(),
      password: String(password),
      name: String(name).trim(),
      server: String(server).trim(),
      platform: platform as 'mt4' | 'mt5',
      magic: Number(magic),
      ...(region != null && { region: String(region).trim() }),
      ...(type != null && { type: type as 'cloud-g1' | 'cloud-g2' }),
      ...(provisioning_profile_id != null && {
        provisioningProfileId: String(provisioning_profile_id),
      }),
    };

    const normalizedLogin = provisionBody.login;
    const normalizedServer = provisionBody.server;

    // 1) DB check: any existing record with this login+server (any user)
    const existingInDb = await MetaApiAccount.findOne({
      where: { login: normalizedLogin, server: normalizedServer },
    });
    if (existingInDb) {
      if (existingInDb.userId === userId) {
        try {
          await syncAccountStateToDb(existingInDb.metaapiAccountId as string);
          await existingInDb.reload();
        } catch {
          // ignore sync errors
        }
        return res.status(200).json(existingInDb);
      }
      return res.status(409).json({
        error: 'Account already linked to another user',
        code: 'ACCOUNT_LINKED_TO_OTHER_USER',
      });
    }

    // 2) Not in DB: check if already provisioned on MetaAPI (by login+server)
    let existingOnMetaApi: Awaited<ReturnType<typeof findMetaApiAccountByLoginAndServer>> = null;
    try {
      existingOnMetaApi = await findMetaApiAccountByLoginAndServer(normalizedLogin, normalizedServer);
    } catch {
      // On MetaAPI list failure, proceed to provision (create might still succeed)
    }
    if (existingOnMetaApi) {
      const metaapiAccountId = existingOnMetaApi._id;
      const defaults = {
        name: provisionBody.name,
        platform: provisionBody.platform,
        region: provisionBody.region ?? existingOnMetaApi.region ?? null,
        state: existingOnMetaApi.state ?? null,
        connectionStatus: existingOnMetaApi.connectionStatus ?? null,
        login: normalizedLogin,
        server: normalizedServer,
        accountType: existingOnMetaApi.type ?? provisionBody.type ?? 'cloud-g2',
      };
      const rec = await MetaApiAccount.findOrCreate({
        where: { userId, metaapiAccountId },
        defaults: defaults as any,
      });
      const row = Array.isArray(rec) ? rec[0] : rec;
      try {
        await syncAccountStateToDb(row.metaapiAccountId as string);
        await row.reload();
      } catch {
        // ignore
      }
      return res.status(200).json(row);
    }

    // 3) Not in DB and not on MetaAPI: create via provisioning API
    try {
      const result = await createAccountViaProvisioningApi(
        provisionBody,
        transaction_id ? String(transaction_id) : undefined
      );
      if (result.status === 'accepted') {
        return res.status(202).json({
          message: result.message ?? 'Account creation in progress',
          transaction_id: result.transactionId,
          retry_after_seconds: result.retryAfterSeconds,
        });
      }
      const metaapiAccountId = result.id;
      const defaults = {
        name: provisionBody.name,
        platform: provisionBody.platform,
        region: provisionBody.region ?? null,
        state: result.state,
        connectionStatus: null as string | null,
        login: provisionBody.login,
        server: provisionBody.server,
        accountType: provisionBody.type ?? 'cloud-g2',
      };
      const rec = await MetaApiAccount.findOrCreate({
        where: { userId, metaapiAccountId },
        defaults: defaults as any,
      });
      const row = Array.isArray(rec) ? rec[0] : rec;
      try {
        await syncAccountStateToDb(row.metaapiAccountId as string);
        await row.reload();
      } catch {
        // ignore
      }
      return res.status(201).json(row);
    } catch (e) {
      if (e instanceof MetaApiProvisioningError) {
        const { status, message, code, details } = mapProvisioningError(e);
        return res.status(status).json({ error: message, code, ...(details && { details }) });
      }
      throw e;
    }
  },
  // Link a MetaAPI account to the authenticated user.
  // Body: metaapi_account_id (required), optional name, platform, region.
  // Optional account: JSON from MetaAPI dashboard (state, connectionStatus, region, name, login, server, type) to store without calling the API.
  link: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { metaapi_account_id, name, platform, region, account: accountJson } = req.body || {};
    const accountId = metaapi_account_id ?? accountJson?._id;
    if (!accountId) {
      return res.status(400).json({ error: 'metaapi_account_id (or account._id) required' });
    }
    try {
      const provisioning = await getAccountFromProvisioningApi(String(accountId));
      if (!provisioning) {
        return res.status(404).json({
          error: 'MetaAPI account not found',
          code: 'METAAPI_ACCOUNT_NOT_FOUND',
        });
      }
      const defaults: Record<string, unknown> = {
        name: name ?? accountJson?.name ?? provisioning.name ?? null,
        platform: platform ?? accountJson?.platform ?? null,
        region: region ?? accountJson?.region ?? provisioning.region ?? null,
        state: accountJson?.state ?? provisioning.state ?? null,
        connectionStatus: accountJson?.connectionStatus ?? provisioning.connectionStatus ?? null,
        login: accountJson?.login ?? provisioning.login ?? null,
        server: accountJson?.server ?? provisioning.server ?? null,
        accountType: accountJson?.type ?? provisioning.type ?? null,
      };
      const rec = await MetaApiAccount.findOrCreate({
        where: { userId, metaapiAccountId: accountId },
        defaults: defaults as any,
      });
      const row = Array.isArray(rec) ? rec[0] : rec;
      try {
        await syncAccountStateToDb(row.metaapiAccountId as string);
        await row.reload();
      } catch {
        // Ignore: link still succeeds; state may be updated later by sync job
      }
      return res.status(201).json(row);
    } catch (e) {
      if (e instanceof MetaApiProvisioningError) {
        const status = e.statusCode === 401 ? 401 : e.statusCode === 403 ? 403 : 400;
        return res.status(status).json({
          error: e.message ?? 'Failed to link MetaAPI account',
          code: e.code ?? 'METAAPI_ERROR',
        });
      }
      throw e;
    }
  },
  // GET /accounts/servers?version=4|5&query=... — known trading servers for dropdown/search
  servers: async (req: Request, res: Response) => {
    const version = req.query.version;
    const query = typeof req.query.query === 'string' ? req.query.query : undefined;
    const v = version === '4' ? 4 : version === '5' ? 5 : 5;
    try {
      const data = await getKnownMtServers(v, query);
      return res.json(data);
    } catch (e) {
      if (e instanceof MetaApiProvisioningError) {
        return res
          .status(e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500)
          .json({ error: e.message ?? 'Failed to fetch trading servers', code: e.code });
      }
      throw e;
    }
  },
  // List linked accounts with balance/account information from MetaAPI when available
  list: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const rows = await MetaApiAccount.findAll({ where: { userId }, order: [['id', 'asc']] });
    const results = await Promise.allSettled(
      rows.map((row) => getAccountInformation(row.metaapiAccountId as string))
    );
    const list = rows.map((row, i) => {
      const payload = row.toJSON() as Record<string, unknown>;
      const settled = results[i];
      payload.accountInformation =
        settled.status === 'fulfilled' ? settled.value : null;
      return payload;
    });
    res.json(list);
  },
  // Unlink by MetaAPI account id (metaapiAccountId), not internal DB id.
  unlink: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const metaapiAccountId = String(req.params.id ?? '').trim();
    if (!metaapiAccountId) {
      return res.status(400).json({ error: 'MetaAPI account id required' });
    }
    const row = await MetaApiAccount.findOne({
      where: { metaapiAccountId, userId },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.status(204).end();
  },
  summary: async (req: Request, res: Response) => {
    const metaId = await resolveOwnedMetaapiAccountId(req);
    const data = await getAccountSummary(metaId);
    res.json(data);
  },
  balance: async (req: Request, res: Response) => {
    const metaId = await resolveOwnedMetaapiAccountId(req);
    const data = await getBalance(metaId);
    res.json(data);
  },
  positions: async (req: Request, res: Response) => {
    const metaId = await resolveOwnedMetaapiAccountId(req);
    const data = await getOpenPositions(metaId);
    res.json(data);
  },
  history: async (req: Request, res: Response) => {
    const metaId = await resolveOwnedMetaapiAccountId(req);
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const data = await getHistory(metaId, from, to);
    res.json(data);
  },
  // Sync account state (state, connectionStatus, region, etc.) from MetaAPI to DB
  syncState: async (req: Request, res: Response) => {
    const metaId = await resolveOwnedMetaapiAccountId(req);
    const updated = await syncAccountStateToDb(metaId);
    if (!updated) {
      return res.status(404).json({ error: 'Account not found in MetaAPI or DB' });
    }
    const id = Number(req.params.id);
    const row = await MetaApiAccount.findOne({ where: { id, userId: getAuth(req).userId! } });
    return res.json(row);
  },
};
