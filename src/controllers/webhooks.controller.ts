import type { Request, Response } from 'express';
import { Webhook } from 'svix';
import { env } from '../config/env';
import { User } from '../db/models/User';

export async function clerkWebhookHandler(req: Request, res: Response) {
  try {
    const svixId = req.header('svix-id');
    const svixTimestamp = req.header('svix-timestamp');
    const svixSignature = req.header('svix-signature');
    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ error: 'Missing svix headers' });
    }

    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
    const payload = req.body as Buffer; // raw body attached by express.raw
    const evt = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as any;

    if (evt?.type === 'user.created' || evt?.type === 'user.updated') {
      const c = evt.data;
      const email =
        c?.email_addresses?.find((e: any) => e.id === c.primary_email_address_id)?.email_address ??
        null;
      await User.upsert({ id: c.id, email, plan: 'free', proExpiry: null });
    }

    return res.status(204).end();
  } catch (err: any) {
    return res
      .status(400)
      .json({ error: 'Invalid webhook', message: err?.message ?? 'verify failed' });
  }
}
