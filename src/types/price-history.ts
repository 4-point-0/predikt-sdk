export interface PricePoint {
  /** Unix timestamp in seconds */
  t: number;
  /** Price in cents (0–100) */
  p: number;
}

export interface MarketPriceHistory {
  marketId: string;
  platform: string;
  title: string;
  yes: PricePoint[];
  no: PricePoint[];
}

export interface PriceHistoryError {
  marketId: string;
  platform: string;
  title: string;
  error: string;
}

export interface MatchedMarketPriceHistoryResponse {
  matchedMarketId: string;
  markets: MarketPriceHistory[];
  errors: PriceHistoryError[];
}

export interface PriceHistoryDetailsResponse {
  id: string;
  matchedMarketId?: string;
  markets: MarketPriceHistory[];
  errors: PriceHistoryError[];
}

export interface PriceHistoryParams {
  interval?: '1h' | '6h' | '1d' | '1w' | '1m' | 'max';
  fidelity?: number;
  startTs?: number;
  endTs?: number;
}
