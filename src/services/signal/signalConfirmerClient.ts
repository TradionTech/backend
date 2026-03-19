import axios, { type AxiosError } from 'axios';
import { env } from '../../config/env';

export type TradeType = 'buy' | 'sell' | 'long' | 'short';

// Request/response shapes must match the frontend contract for this facade endpoint.
export interface SignalConfirmationRequest {
  symbol: string;
  entry: number;
  take_profit: number;
  stop_loss: number;
  trade_type: TradeType;
}

export interface SignalConfirmationResponse {
  symbol: string;
  sentiment: string;
  confidence: number;
  news_score: number;
}

const client = axios.create({
  baseURL: env.SIGNAL_CONFIRMER_BASE_URL,
  timeout: env.SIGNAL_CONFIRMER_TIMEOUT_MS,
});

function ensureConfigured(): void {
  if (!env.SIGNAL_CONFIRMER_BASE_URL?.trim()) {
    const e: any = new Error('SIGNAL_CONFIRMER_BASE_URL is not configured');
    e.status = 503;
    throw e;
  }
}

export async function confirmSignal(
  payload: SignalConfirmationRequest
): Promise<SignalConfirmationResponse> {
  ensureConfigured();

  try {
    const { data } = await client.post<SignalConfirmationResponse>(
      env.SIGNAL_CONFIRMER_ENDPOINT,
      payload
    );
    return data;
  } catch (err: unknown) {
    // Re-throw with AxiosError so the controller can map status codes.
    throw err as AxiosError;
  }
}

