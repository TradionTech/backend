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
  accountId: number;
  symbol: string | null;
  type: string | null;
  volume: number | null;
  price: number | null;
  commission: number | null;
  swap: number | null;
  profit: number | null;
  time: Date | string | null;
  timeOpen: Date | string | null;
  timeClose: Date | string | null;
  comment: string | null;
  orderId: string | null;
  dealId: string | null;

  // MetaApi-specific fields
  positionId: string | null;
  metaapiDealId: string | null;
  metaapiOrderId: string | null;
  magic: number | null;
  platform: 'mt4' | 'mt5' | null;
  entryType: string | null;
  dealType: string | null;
  orderState: string | null;
  brokerTime: string | null;
  doneTime: Date | string | null;
  doneBrokerTime: string | null;
  currentVolume: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  clientId: string | null;
  brokerComment: string | null;
  reason: string | null;
  accountCurrencyExchangeRate: number | null;
  stopLimitPrice: number | null;
  trailingStopLoss: object | null;
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
