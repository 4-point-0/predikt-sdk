import { HttpClient, QueryParams } from '../http-client.js';
import {
  MarketPriceHistory,
  MatchedMarketPriceHistoryResponse,
  PriceHistoryDetailsResponse,
  PriceHistoryParams,
} from '../types/price-history.js';

export class PriceHistoryClient {
  constructor(private readonly http: HttpClient) {}

  forMarket(marketId: string, params?: PriceHistoryParams): Promise<MarketPriceHistory> {
    return this.http.get<MarketPriceHistory>(
      `/price-history/market/${marketId}`,
      params as QueryParams,
    );
  }

  forMatchedMarket(
    matchedMarketId: string,
    params?: PriceHistoryParams,
  ): Promise<MatchedMarketPriceHistoryResponse> {
    return this.http.get<MatchedMarketPriceHistoryResponse>(
      `/price-history/matched-market/${matchedMarketId}`,
      params as QueryParams,
    );
  }

  /** Auto-resolves the ID as either a market or matched-market and returns combined price history details. */
  getPriceHistory(id: string, params?: PriceHistoryParams): Promise<PriceHistoryDetailsResponse> {
    return this.http.get<PriceHistoryDetailsResponse>(`/price-history/${id}`, params as QueryParams);
  }
}
