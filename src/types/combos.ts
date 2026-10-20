// Polymarket Combos (parlays) on integrator-owned Deposit Wallets (`/combos/*`).
// Server-side only: every endpoint requires a BACKEND API key.
//
// Amounts and shares are 6-decimal base-unit strings; prices are decimal strings.
// Statuses are UPPERCASE here, unlike direct trading.

import { PaginatedResponse } from './common.js';
import { WalletRef } from './direct.js';

/**
 * Final: `FILLED` (amounts final) and `FAILED` (nothing traded; see `error.code`).
 * Not final: `PENDING`, `EXECUTING` — keep funds reserved and poll; never place a replacement
 * for an `EXECUTING` order. See `isComboOrderFinal`.
 */
export type ComboOrderStatus = 'PENDING' | 'EXECUTING' | 'FILLED' | 'FAILED';

export type ComboOrderDirection = 'BUY' | 'SELL' | 'REDEEM';

/** `API`: placed through Predikt. `POLYMARKET_AUTO`: a payout Polymarket made on its own. */
export type ComboOrderSource = 'API' | 'POLYMARKET_AUTO';

/** A ticket leg: market from `combos.listMarkets` and outcome index (0 = first, usually Yes). */
export interface ComboLeg {
  marketId: string;
  outcome: 0 | 1;
}

// ─── Markets and quotes ──────────────────────────────────────────────────────

/** `outcomes`, `prices` and `positionIds` align by index. */
export interface ComboMarket {
  /** Send as a leg's `marketId`. */
  marketId: string;
  conditionId: string;
  slug: string;
  title: string;
  outcomes: string[];
  prices: string[];
  positionIds: string[];
  image: string | null;
  volume: number | null;
  tags: string[];
}

export interface ComboMarketsQuery {
  /** 1–1000. */
  limit?: number;
  cursor?: string;
}

export interface ComboMarketsPage {
  /** Ordered by volume. */
  markets: ComboMarket[];
  /** Null on the last page. */
  nextCursor: string | null;
}

export interface ComboQuoteRequest {
  /** 2–50 legs, no duplicate markets. */
  legs: ComboLeg[];
  /** pUSD to spend, base units. */
  amount: string;
}

export interface ComboQuoteLeg extends ComboLeg {
  positionId: string;
  title: string;
  outcomeLabel: string;
  price: string;
}

/** Indicative only: the real RFQ quote is usually a bit higher (spread, fees, correlation). */
export interface ComboQuote {
  /** Product of leg prices. Suggest `maxPrice` from it, e.g. +10%. */
  indicativePrice: string;
  estimatedShares: string;
  /** pUSD paid if every leg wins (1 pUSD per share), base units. */
  potentialPayout: string;
  legs: ComboQuoteLeg[];
}

// ─── Orders ──────────────────────────────────────────────────────────────────

/**
 * `clientOrderId` (1–100 chars) is the idempotency key, unique per integrator across all combo
 * orders: repeating the same request returns the original order; reusing it for a different
 * request is `409 COMBO_CLIENT_ORDER_ID_REUSED` (`details.orderId` = the existing order).
 */
export interface ComboBuyRequest {
  /** The account's Deposit Wallet (or the account object). */
  wallet: WalletRef;
  /** 2–50 legs, no duplicate markets. */
  legs: ComboLeg[];
  /** pUSD budget including fees, base units; never exceeded. */
  amount: string;
  /** Max price per share including fees, decimal in (0, 1]. */
  maxPrice: string;
  clientOrderId: string;
}

export interface ComboSellRequest {
  wallet: WalletRef;
  /** From the FILLED buy (`comboConditionId`). */
  comboConditionId: string;
  /** Shares to sell, base units. */
  shares: string;
  /** Min net price per share after fees, decimal in (0, 1]. */
  minPrice: string;
  clientOrderId: string;
  /** Accept a quote for fewer shares than requested (default false). */
  allowPartialFill?: boolean;
}

/** Fallback only: Polymarket pays out resolved combos automatically (`POLYMARKET_AUTO` orders). */
export interface ComboRedeemRequest {
  wallet: WalletRef;
  comboConditionId: string;
  clientOrderId: string;
}

export interface ComboOrderLeg {
  marketId: string;
  outcome: 0 | 1;
  outcomeLabel: string;
  title: string;
  positionId: string;
}

export interface ComboOrderError {
  /** e.g. `NO_QUOTES`, `PRICE_ABOVE_MAX`, `SIGNING_FAILED`, `COMBO_ALREADY_REDEEMED`. */
  code: string;
  message: string | null;
}

export interface ComboOrder {
  id: string;
  /** `polymarket-auto:<txHash>` for automatic payouts. */
  clientOrderId: string;
  /** Deposit Wallet, lowercase. */
  wallet: string;
  direction: ComboOrderDirection;
  source: ComboOrderSource;
  status: ComboOrderStatus;
  /** Keep it: needed to sell and redeem. */
  comboConditionId: string | null;
  comboPositionId: string | null;
  legs: ComboOrderLeg[];
  /** BUY: budget. Otherwise null. */
  requestedAmount: string | null;
  /** SELL: shares requested. REDEEM: shares held when requested. BUY: null. */
  requestedShares: string | null;
  /** BUY: max price incl. fees. SELL: min net price. REDEEM: null. */
  limitPrice: string | null;
  /** Maker price before fees. */
  quotedPrice: string | null;
  /** BUY: pUSD per share incl. fees. SELL: pUSD per share after fees. */
  effectivePrice: string | null;
  /** BUY: shares received. SELL: shares sold. REDEEM: shares redeemed. */
  shares: string | null;
  /** BUY: pUSD spent incl. fees. SELL: pUSD received. REDEEM: pUSD paid out. */
  amount: string | null;
  rfqId: string | null;
  txHash: string | null;
  error: ComboOrderError | null;
  createdAt: string;
  filledAt: string | null;
}

export interface ComboOrdersQuery {
  wallet?: WalletRef;
  status?: ComboOrderStatus;
  /** 1–100 (default 20). */
  limit?: number;
  offset?: number;
}

/** Newest first, offset-paginated. Not a change feed: poll pending orders by id. */
export type ComboOrdersPage = PaginatedResponse<ComboOrder[]>;

// ─── Polymarket data API pass-through (snake_case, unchanged) ────────────────

export type ComboPositionStatus =
  | 'OPEN'
  | 'PARTIAL'
  | 'REDEEMABLE'
  | 'RESOLVED_WIN'
  | 'RESOLVED_LOSS'
  | 'RESOLVED_PARTIAL';

export interface ComboDataApiPage<T> {
  data: T[];
  pagination?: { has_more?: boolean; next_cursor?: string | null };
}

/** Polymarket combo position (loosely typed: fields are Polymarket's and may change). */
export interface ComboPosition {
  combo_condition_id: string;
  combo_position_id: string;
  /** Shares held, decimal (not base units). */
  current_size: number | string;
  redeemable: boolean;
  realized_payout_usdc?: number | string | null;
  legs?: Array<{ leg_status?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Polymarket combo activity row. Not for accounting: it omits cash-outs and amounts are floats;
 * use `combos.listOrders` instead.
 */
export interface ComboActivity {
  type: string;
  combo_condition_id: string;
  transaction_hash: string;
  /** Unix seconds. */
  timestamp: number;
  amount_usdc?: number | string | null;
  payout_usdc?: number | string | null;
  [key: string]: unknown;
}

export interface ComboPositionsQuery {
  wallet: WalletRef;
  status?: ComboPositionStatus;
  /** Combo condition id. */
  condition?: string;
  /** 1–100. */
  limit?: number;
  cursor?: string;
}

export interface ComboActivityQuery {
  wallet: WalletRef;
  condition?: string;
  limit?: number;
  cursor?: string;
}
