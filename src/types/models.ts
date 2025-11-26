export interface User {
  id: string;
  email: string | null;
  plan: 'free' | 'pro';
  proExpiry: Date | null;
}

export interface ChatSession {
  id: string;
  userId: string;
  context: object | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AccountSummary {
  balance: number;
  equity: number;
  currency: string;
}

export interface Position {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  profit: number;
}

export interface TradeHistoryEntry {
  id: string;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  time: Date | string;
}

export interface MarketPrice {
  symbol: string;
  timeframe?: string;
  candles?: Array<[number, number, number, number, number]>; // ts, o,h,l,c
  price?: number;
}

export interface EconomicEvent {
  time: string;
  country: string;
  title: string;
  impact?: string;
}
