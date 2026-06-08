import { HttpClient, QueryParams } from '../http-client';
import {
  MarketPriceHistory,
  MatchedMarketPriceHistoryResponse,
  PriceHistoryParams,
} from '../types/price-history';

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
}
