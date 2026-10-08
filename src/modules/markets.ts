import { HttpClient, QueryParams } from '../http-client.js';
import {
  FavoriteResponse,
  FavoritesQuery,
  MarketDetailsResponse,
  MarketGroupDetailsDto,
  MarketsQuery,
  PaginatedMarketGroups,
} from '../types/markets.js';

export class MarketsClient {
  constructor(private readonly http: HttpClient) {}

  list(query?: MarketsQuery): Promise<PaginatedMarketGroups> {
    return this.http.get<PaginatedMarketGroups>('/markets', query as QueryParams);
  }

  /** Get a single market by its ID, including best odds and optional matched-market group context. */
  getMarket(id: string): Promise<MarketDetailsResponse> {
    return this.http.get<MarketDetailsResponse>(`/markets/${id}`);
  }

  /** Get a market group by any market ID within the group. Pass `wallet` to populate `isFavourite`. */
  get(id: string, wallet?: string): Promise<MarketGroupDetailsDto> {
    return this.http.get<MarketGroupDetailsDto>(`/markets/${id}/details`, wallet ? { wallet } : undefined);
  }

  /** Get a market group by matched-market ID. */
  getByMatchedMarketId(matchedMarketId: string): Promise<MarketGroupDetailsDto> {
    return this.http.get<MarketGroupDetailsDto>(`/matched-markets/${matchedMarketId}`);
  }

  /** Get a market group via its matched-market relationship, by any constituent market ID. */
  getMatchedGroup(id: string): Promise<MarketGroupDetailsDto> {
    return this.http.get<MarketGroupDetailsDto>(`/markets/${id}/matched-group`);
  }

  getWorldCup2026(query?: MarketsQuery): Promise<PaginatedMarketGroups> {
    return this.http.get<PaginatedMarketGroups>('/markets/world-cup-2026', query as QueryParams);
  }

  addFavorite(marketId: string): Promise<FavoriteResponse[]> {
    return this.http.post<FavoriteResponse[]>('/markets/favorites', { marketId });
  }

  removeFavorite(marketId: string): Promise<void> {
    return this.http.delete<void>(`/markets/favorites/${marketId}`);
  }

  listFavorites(query: FavoritesQuery): Promise<PaginatedMarketGroups> {
    return this.http.get<PaginatedMarketGroups>('/markets/favorites', query as unknown as QueryParams);
  }
}
