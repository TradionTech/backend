import axios from 'axios';
import { env } from '../../config/env';

const client = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
});

export const paystack = {
  async initialize(input: { amountKobo: number; email: string; metadata?: Record<string, any> }) {
    const { data } = await client.post('/transaction/initialize', {
      amount: input.amountKobo,
      email: input.email,
      metadata: input.metadata,
    });
    if (!data?.status) throw new Error('Paystack init failed');
    return data.data as { authorization_url: string; access_code: string; reference: string };
  },

  async verify(reference: string) {
    const { data } = await client.get(`/transaction/verify/${reference}`);
    const status = data?.data?.status ?? 'failed';
    return { status, raw: data?.data };
  },
};
