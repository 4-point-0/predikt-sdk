import { MarketCategory, MarketStatus, Outcome, PaginatedResponse, PlatformType, PositionStatus } from './common';

export interface PositionMarket {
  title: string;
  rules: string;
  category: MarketCategory;
  status: MarketStatus;
  winningOutcome: Outcome | null;
  volume: number;
  liquidity: number;
  startDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
}

export interface PositionResponse {
  id: string;
  marketId: string | null;
  userAddress: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  /** Normalized from 6 decimals */
  shares: number;
  /** Normalized from 6 decimals */
  averageCost: number;
  /** Normalized from 6 decimals */
  totalCost: number;
  /** Current market value in USD */
  value: number | null;
  /** Lifetime PnL as percentage */
  pnl: number | null;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
  /** null = market not yet determined */
  isWinner: boolean | null;
  market: PositionMarket | null;
}

export interface PositionsQuery {
  userAddress: string;
  status?: PositionStatus;
  source?: PlatformType;
  winner?: boolean;
  marketId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export type PaginatedPositions = PaginatedResponse<{ positions: PositionResponse[] }>;
