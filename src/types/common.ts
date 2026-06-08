export enum WalletChain {
  SOLANA = 'solana',
  SUI = 'sui',
}

export enum Outcome {
  YES = 0,
  NO = 1,
}

/** Mayan bridge chain IDs */
export enum SourceChain {
  SOLANA = '1',
  SUI = '21',
}

export enum PlatformType {
  POLYMARKET = 'polymarket',
  KALSHI = 'kalshi',
  LIMITLESS = 'limitless',
}

export enum MarketCategory {
  SPORTS = 'Sports',
  POLITICS = 'Politics',
  CRYPTO = 'Crypto',
  ECONOMICS = 'Economics',
  TECH_SCIENCE = 'Tech & Science',
  OTHER = 'Other',
}

export enum MarketStatus {
  UNOPENED = 'UNOPENED',
  OPEN = 'OPEN',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
  DETERMINED = 'DETERMINED',
  SETTLED = 'SETTLED',
}

export enum MarketSortOption {
  NEWEST = 'newest',
  VOLUME = 'volume',
  LIQUIDITY = 'liquidity',
  CLOSING = 'closing',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum BuyOrderStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum SellOrderStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  SOLD = 'SOLD',
  BRIDGING = 'BRIDGING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum RedeemOrderStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  BRIDGING = 'BRIDGING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum MarketMatchType {
  EXACT = 'exact',
  RELATED = 'related',
}

export interface PaginationMeta {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  data: T;
  pagination: PaginationMeta;
}
