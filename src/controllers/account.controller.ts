import type { Request, Response } from 'express';
import {
  getAccountSummary,
  getOpenPositions,
  getHistory,
  getBalance,
} from '../services/brokers/metaapi';
import { MetaApiAccount } from '../db/models/MetaApiAccount';

async function resolveOwnedMetaapiAccountId(req: Request): Promise<string> {
  const userId = (req as any).auth?.userId as string;
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
  // Link a MetaAPI account to the authenticated user
  link: async (req: Request, res: Response) => {
    const userId = (req as any).auth?.userId as string;
    const { metaapi_account_id, name, platform, region } = req.body || {};
    if (!metaapi_account_id) return res.status(400).json({ error: 'metaapi_account_id required' });
    const rec = await MetaApiAccount.findOrCreate({
      where: { userId, metaapiAccountId: metaapi_account_id },
      defaults: { name: name ?? null, platform: platform ?? null, region: region ?? null },
    });
    const row = Array.isArray(rec) ? rec[0] : rec;
    res.status(201).json(row);
  },
  // List linked accounts
  list: async (req: Request, res: Response) => {
    const userId = (req as any).auth?.userId as string;
    const rows = await MetaApiAccount.findAll({ where: { userId }, order: [['id', 'asc']] });
    res.json(rows);
  },
  // Unlink
  unlink: async (req: Request, res: Response) => {
    const userId = (req as any).auth?.userId as string;
    const id = Number(req.params.id);
    const row = await MetaApiAccount.findOne({ where: { id, userId } });
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
};
