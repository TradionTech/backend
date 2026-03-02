import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import {
  getAccountSummary,
  getOpenPositions,
  getHistory,
  getBalance,
  syncAccountStateToDb,
  createAccountViaProvisioningApi,
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

export const accountController = {
  // Provision a new MetaAPI account and link it to the current user.
  // Body: login, password, name, server, platform (mt4|mt5), magic; optional region, type, provisioningProfileId, transaction_id (for retry after 202).
  // On 201 returns the linked account; on 202 returns transaction_id and retry_after so client can retry with same body + transaction_id.
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
    const defaults: Record<string, unknown> = {
      name: name ?? accountJson?.name ?? null,
      platform: platform ?? null,
      region: region ?? accountJson?.region ?? null,
      state: accountJson?.state ?? null,
      connectionStatus: accountJson?.connectionStatus ?? null,
      login: accountJson?.login ?? null,
      server: accountJson?.server ?? null,
      accountType: accountJson?.type ?? null,
    };
    const rec = await MetaApiAccount.findOrCreate({
      where: { userId, metaapiAccountId: accountId },
      defaults: defaults as any,
    });
    const row = Array.isArray(rec) ? rec[0] : rec;
    // Sync state from MetaAPI so DB has up-to-date state/connectionStatus (or keep from account JSON)
    try {
      await syncAccountStateToDb(row.metaapiAccountId as string);
      await row.reload();
    } catch {
      // Ignore: link still succeeds; state may be updated later by sync job
    }
    res.status(201).json(row);
  },
  // List linked accounts
  list: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const rows = await MetaApiAccount.findAll({ where: { userId }, order: [['id', 'asc']] });
    res.json(rows);
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
