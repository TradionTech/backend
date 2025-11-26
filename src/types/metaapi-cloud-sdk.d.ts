declare module 'metaapi.cloud-sdk' {
  export default class MetaApi {
    constructor(token: string);
    metatraderAccountApi: {
      getAccount(accountId: string): Promise<MetatraderAccount>;
    };
  }

  export interface MetatraderAccount {
    state?: string;
    deploy(): Promise<void>;
    waitConnected(): Promise<void>;
    getRPCConnection(): RPCConnection;
  }

  export interface RPCConnection {
    connect(): Promise<void>;
    getAccountInformation(): Promise<any>;
    getPositions(): Promise<MetatraderPosition[]>;
    getHistoryOrdersByTimeRange(start: Date, end: Date): Promise<any>;
  }

  export interface MetatraderPosition {
    id?: string | number;
    symbol: string;
    type: string;
    volume: number;
    price?: number;
    priceOpen?: number;
    sl?: number;
    tp?: number;
    unrealizedProfit?: number;
    profit?: number;
    [key: string]: unknown;
  }
}

declare module 'metaapi.cloud-sdk/esm-node' {
  import MetaApi from 'metaapi.cloud-sdk';
  export default MetaApi;
}
