import { BuyOrderStatus, Outcome, PlatformType, RedeemOrderStatus, SellOrderStatus, SourceChain } from './common';

// ─── Simulation ──────────────────────────────────────────────────────────────

export interface SimulateBuyRequest {
  platform: PlatformType;
  ticker: string;
  outcome: Outcome;
  /** Amount in USDC with 6 decimals, e.g. "10000000" = 10 USDC */
  usdcAmount: string;
}

export interface SimulateSellRequest {
  platform: PlatformType;
  ticker: string;
  outcome: Outcome;
  /** Synthetic position amount with 6 decimals */
  positionAmount: string;
}

export interface SimulatedFill {
  price: string;
  size: string;
  cost: string;
}

export interface SimulateOrderResponse {
  fullyFillable: boolean;
  totalCost: string;
  totalContracts: string;
  averagePrice: string;
  bestPrice: string | null;
  levelsConsumed: number;
  worstPrice: string | null;
  fills: SimulatedFill[];
}

export type SimulateAllResponse = Partial<Record<PlatformType, SimulateOrderResponse>> & {
  bestPlatform?: PlatformType;
  /** Calling integrator's fee rate in basis points (100 = 1%). Returned by buy simulate; currently absent on sell simulate. */
  feeBps?: number;
};

// ─── Buy ─────────────────────────────────────────────────────────────────────

export interface BuyOrderRequest {
  sourceChain?: SourceChain;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  /** Amount in USDC with 6 decimals */
  usdcAmount: string;
  /** Minimum 2.5, defaults to 2.5 */
  slippagePercent?: number;
}

export interface BuyOrderResponse {
  id: string;
  sourceChain: SourceChain;
  userSourceAddr: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  usdcAmount: string;
  maxPrice: string | null;
  bridgeAmount: string | null;
  bridgeTxHash: string | null;
  status: BuyOrderStatus;
  externalOrder: string | null;
  filledAmount: string | null;
  settlementTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuyOrderResponse {
  order: BuyOrderResponse;
  /** Base64-encoded unsigned transaction bytes — sign and submit on-chain, then call setTxHash */
  transaction: { bytes: string };
  quote: {
    expectedOutput: string;
    bridgeFee: string;
    estimatedTime: number;
  };
}

export interface BatchBuyOrderResponse {
  batchId: string;
  orders: Array<{
    id: string;
    ticker: string;
    source: PlatformType;
    outcome: Outcome;
    usdcAmount: string;
    groupId: string;
  }>;
  transactions: Array<{ groupId: string; bytes: string; orderIds: string[] }>;
  quote: { totalAmount: string; totalBridgeFee: string; estimatedTime: number };
}

// ─── Sell ─────────────────────────────────────────────────────────────────────

export interface SellOrderRequest {
  sourceChain?: SourceChain;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  /** Sui position object ID — auto-resolved if omitted */
  positionId?: string;
  /** Synthetic position amount with 6 decimals */
  positionAmount: string;
  /** Defaults to false (sell entire position) */
  isPartial?: boolean;
  /** Minimum 2.5, defaults to 2.5 */
  slippagePercent?: number;
}

export interface SellOrderResponse {
  id: string;
  sourceChain: SourceChain;
  userSourceAddr: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  positionId: string | null;
  positionAmount: string;
  minPrice: string | null;
  isPartial: boolean;
  status: SellOrderStatus;
  onChainOrderId: string | null;
  onChainTxHash: string | null;
  externalOrder: string | null;
  usdcReceived: string | null;
  bridgeTxHash: string | null;
  settlementTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSellOrderResponse {
  order: SellOrderResponse;
  /** Base64-encoded unsigned transaction bytes — sign and submit on-chain, then call setSolanaTx */
  transaction: { bytes: string };
}

export interface BatchSellOrderResponse {
  batchId: string;
  orders: SellOrderResponse[];
  transaction: { bytes: string };
}

// ─── Redeem ───────────────────────────────────────────────────────────────────

export interface RedeemOrderRequest {
  sourceChain?: SourceChain;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  /** Omit to redeem full balance */
  amount?: string;
}

export interface RedeemOrderResponse {
  id: string;
  sourceChain: SourceChain;
  userSourceAddr: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  positionAmount: string | null;
  status: RedeemOrderStatus;
  onChainTxHash: string | null;
  usdcReceived: string | null;
  bridgeTxHash: string | null;
  settlementTxHash: string | null;
  marketRedemptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRedeemOrderResponse {
  order: RedeemOrderResponse;
  /** Base64-encoded unsigned transaction bytes — sign and submit on-chain, then call setSolanaTx */
  transaction: { bytes: string };
}
