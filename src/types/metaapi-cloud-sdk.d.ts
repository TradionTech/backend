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
    getStreamingConnection(historyStorage?: HistoryStorage): StreamingConnection;
  }

  export interface RPCConnection {
    connect(): Promise<void>;
    getAccountInformation(): Promise<any>;
    getPositions(): Promise<MetatraderPosition[]>;
    getHistoryOrdersByTimeRange(start: Date, end: Date): Promise<any>;
  }

  /** Streaming connection: syncs terminal state locally and exposes historyStorage + terminalState. */
  export interface StreamingConnection {
    connect(): Promise<void>;
    waitSynchronized(): Promise<void>;
    get terminalState(): TerminalState;
    get historyStorage(): HistoryStorage;
    addSynchronizationListener(listener: SynchronizationListener): void;
    removeSynchronizationListener(listener: SynchronizationListener): void;
    close(): void;
  }

  export interface TerminalState {
    connected?: boolean;
    connectedToBroker?: boolean;
    accountInformation?: any;
    positions?: any[];
    orders?: any[];
    specification(symbol: string): any;
    price(symbol: string): any;
  }

  /** Abstract history storage for deals and orders. SDK uses this when streaming. */
  export abstract class HistoryStorage {
    /** Called by SDK when the streaming connection is set up. */
    initialize?(): Promise<void>;
    abstract get orderSynchronizationFinished(): boolean;
    abstract get dealSynchronizationFinished(): boolean;
    abstract get deals(): any[];
    abstract dealsByTicket(ticket: string): any[];
    abstract dealsByPosition(positionId: string): any[];
    abstract dealsByTimeRange(start: Date, end: Date): any[];
    abstract get historyOrders(): any[];
    abstract historyOrdersByTicket(ticket: string): any[];
    abstract historyOrdersByPosition(positionId: string): any[];
    abstract historyOrdersByTimeRange(start: Date, end: Date): any[];
    /** SDK uses for incremental order sync. Must return a Date (SDK calls .getTime()). */
    lastHistoryOrderTime?(): Date;
    /** SDK may use for incremental deal sync. Must return a Date (SDK calls .getTime()). */
    lastHistoryDealTime?(): Date;
    /** SDK calls this name for last deal time. */
    lastDealTime?(): Date;
    /** Called by SDK when merging incoming deal history. */
    mergeDeals?(deals: any[]): void;
    /** Called by SDK when merging incoming order history. */
    mergeOrders?(orders: any[]): void;
  }

  export interface SynchronizationListener {
    onConnected?(): void;
    onSynchronizationStarted?(instanceIndex?: string): void;
    onBrokerConnectionStatusChanged?(instanceIndex: string, connected: boolean): void;
    onHealthStatus?(instanceIndex: string, status: any): void;
    onSymbolSpecificationUpdated?(instanceIndex: string, specification?: any): void;
    onSymbolSpecificationsUpdated?(instanceIndex: string, specifications?: any): void;
    onAccountInformationUpdated?(instanceIndex: string, accountInformation: any): void;
    onPositionsReplaced?(instanceIndex: string, positions: any[]): void;
    onPositionsSynchronized?(instanceIndex: string, synchronizationId?: string): void;
    onPositionUpdated?(instanceIndex: string, position: any): void;
    onPositionRemoved?(instanceIndex: string, positionId: string): void;
    onPendingOrdersReplaced?(instanceIndex: string, orders: any[]): void;
    onPendingOrdersSynchronized?(instanceIndex: string, synchronizationId?: string): void;
    onOrderUpdated?(instanceIndex: string, order: any): void;
    onOrderCompleted?(instanceIndex: string, order: any): void;
    onOrderSynchronizationFinished?(instanceIndex: string, synchronizationId: string): void;
    onHistoryOrdersSynchronized?(instanceIndex: string, synchronizationId?: string): void;
    onDealSynchronizationFinished?(instanceIndex: string, synchronizationId: string): void;
    onDealsSynchronized?(instanceIndex?: string, synchronizationId?: string): void;
    onDealAdded?(instanceIndex: string, deal: any): void;
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
