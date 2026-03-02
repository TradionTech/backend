/**
 * Shared Finnhub API client for sentiment providers.
 */

import axios, { type AxiosInstance } from 'axios';

const FINNHUB_BASE_URL =
  process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

export function createFinnhubClient(): AxiosInstance {
  if (!FINNHUB_API_KEY) {
    throw new Error('FINNHUB_API_KEY is not set');
  }
  return axios.create({
    baseURL: FINNHUB_BASE_URL,
    params: { token: FINNHUB_API_KEY },
    timeout: 5000,
  });
}

export function hasFinnhubConfig(): boolean {
  return Boolean(FINNHUB_API_KEY);
}
