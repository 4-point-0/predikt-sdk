import { MarketCategory, MarketSortOption, MarketStatus, PlatformType, SortOrder, PaginatedResponse } from './common';

export interface MarketDto {
  id: string;
  platform: PlatformType;
  platformMarketId: string;
  ticker: string;
  title: string;
  rules: string;
  status: MarketStatus;
  category: MarketCategory;
  startDate: string | null;
  endDate: string | null;
  yesAsk: number;
  yesBid: number;
  noAsk: number;
  noBid: number;
  volume: number;
  liquidity: number;
  imageUrl: string | null;
  /** Groups sibling markets of one multi-outcome event (e.g. election candidates); null for standalone yes/no markets */
  eventKey: string | null;
  /** Human-readable title of the parent event; null for standalone markets */
  eventTitle: string | null;
  /** This market's outcome label within the event (e.g. a candidate name); null for standalone markets */
  outcomeLabel: string | null;
  /** Venue display label for the YES side; null when the venue uses plain Yes/No */
  yesLabel: string | null;
  /** Venue display label for the NO side; null when the venue uses plain Yes/No */
  noLabel: string | null;
  /** Venue-specific extra metadata; shape varies by platform */
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  isBestOddsYes?: boolean | null;
  isBestOddsNo?: boolean | null;
}

export interface MarketGroupDto {
  id: string;
  isGroupOfMultipleMarkets: boolean;
  title: string;
  description: string;
  category: MarketCategory;
  totalVolume: string;
  totalLiquidity: string;
  markets: MarketDto[];
  isFavourite?: boolean;
}

export interface BestOdds {
  marketBestOddsForYes: string | null;
  marketBestOddsForNo: string | null;
}

export interface MarketGroupDetailsDto extends MarketGroupDto {
  bestOdds: BestOdds;
}

export interface MarketsQuery {
  search?: string;
  sort?: MarketSortOption;
  sortOrder?: SortOrder;
  categories?: MarketCategory[];
  platforms?: PlatformType[];
  onlyMatched?: boolean;
  page?: number;
  limit?: number;
}

export interface FavoritesQuery extends MarketsQuery {
  wallet: string;
}

export interface MarketDetailsMatchGroup {
  marketGroupData: {
    id: string;
    title: string;
    description: string;
    category: MarketCategory;
    totalVolume: string;
    totalLiquidity: string;
  };
  matchings: MarketDto[];
}

export interface MarketDetailsResponse {
  marketDetails: MarketDto;
  matchGroup?: MarketDetailsMatchGroup;
  bestOdds: BestOdds;
}

export interface FavoriteResponse {
  id: string;
  marketId: string;
  createdAt: string;
}

export type PaginatedMarketGroups = PaginatedResponse<{ markets: MarketGroupDto[] }>;
