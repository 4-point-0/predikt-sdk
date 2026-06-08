export interface MarketFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface MarketUpdateEvent {
  type: 'market_update';
  marketId: string;
  matchedMarketId: string | null;
  changes: MarketFieldChange[];
  timestamp: number;
}

export type WsEventMap = {
  market_update: MarketUpdateEvent;
  pong: void;
  open: void;
  close: void;
  error: Error;
};

export type WsEventName = keyof WsEventMap;
