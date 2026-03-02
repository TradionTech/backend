import type { Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { paystack } from '../services/payments/paystack';
import { Payment } from '../db/models/Payment';
import { User } from '../db/models/User';
import { Subscription } from '../db/models/Subscription';

export const billingController = {
  initiate: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Decide amount/plan client-side or pass type in body
    const { amountKobo, email, isSubscription } = req.body; // validate in production

    const init = await paystack.initialize({
      amountKobo,
      email,
      metadata: { userId, isSubscription },
    });
    // store pending payment
    await Payment.create({
      userId,
      reference: init.reference,
      amount: amountKobo,
      status: 'pending',
      currency: 'NGN',
      meta: { isSubscription },
    });
    res.json({ authorization_url: init.authorization_url, reference: init.reference });
  },

  verify: async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { reference } = req.query as { reference: string };
    const ver = await paystack.verify(reference);

    const pay = await Payment.findOne({ where: { reference } });
    if (!pay) return res.status(404).json({ error: 'payment_not_found' });

    if (ver.status === 'success') {
      pay.status = 'success';
      pay.meta = ver.raw;
      await pay.save();

      // Upgrade user
      const user = await User.findByPk(userId);
      if (user) {
        user.plan = 'pro';
        // optional: set proExpiry for one-time time-limited
        await user.save();
      }
    } else {
      pay.status = 'failed';
      pay.meta = ver.raw;
      await pay.save();
    }

    res.json({ status: ver.status });
  },

  webhook: async (req: Request, res: Response) => {
    // TODO: verify Paystack signature header
    const event = req.body;

    if (event?.event === 'charge.success') {
      const reference = event.data?.reference;
      const email = event.data?.customer?.email;
      const authCode = event.data?.authorization?.authorization_code || null;

      const pay = await Payment.findOne({ where: { reference } });
      if (pay) {
        pay.status = 'success';
        pay.meta = event.data;
        await pay.save();

        const userId = (pay.meta as any)?.metadata?.userId ?? pay.userId;
        const isSubscription = (pay.meta as any)?.metadata?.isSubscription;

        const user = await User.findByPk(userId);
        if (user) {
          user.plan = 'pro';
          await user.save();
        }

        if (isSubscription && user) {
          // Upsert subscription record (store auth code for future charges if needed)
          await Subscription.upsert({
            userId: user.id,
            provider: 'paystack',
            plan: 'pro',
            status: 'active',
            authCode,
          });
        }
      }
    }
    res.sendStatus(200);
  },
};
