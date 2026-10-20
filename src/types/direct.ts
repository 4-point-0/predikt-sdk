// Direct trading on Polymarket with integrator-owned Privy wallets (`/direct/*`).
// Server-side only: every endpoint requires a BACKEND API key.
//
// Units: pUSD amounts and shares are strings in 6-decimal base units ("1000000" = 1 pUSD or
// 1 share); prices are decimal strings ("0.37"). Never convert base units to a JS number.

// ─── References ──────────────────────────────────────────────────────────────

/**
 * A trading account: its `accountId`, or any object carrying it (e.g. the `TradingAccount`
 * returned by `accounts.register`).
 */
export type AccountRef = string | { accountId: string | null };

/**
 * A Deposit Wallet address, or any object carrying it (e.g. the `TradingAccount` returned by
 * `accounts.register`). Combo endpoints identify the account by this address.
 */
export type WalletRef = string | { depositWalletAddress: string | null };

// ─── Privy app ───────────────────────────────────────────────────────────────

export type PrivyAppEnvironment = 'development' | 'production';

export type PrivyAppStatus = 'pending_verification' | 'active' | 'suspended' | 'revoked';

export interface ConnectPrivyAppRequest {
  appId: string;
  environment: PrivyAppEnvironment;
}

export interface PrivyApp {
  appId: string;
  environment: PrivyAppEnvironment;
  status: PrivyAppStatus;
}

// ─── Trading accounts (onboarding) ───────────────────────────────────────────

/**
 * - `provisioning`: the Deposit Wallet is being deployed; repeat the same register request.
 * - `awaiting_owner_approval`: sign `approval` with the owner key, then activate. With a non-null
 *   `activeGrant` this means "re-authorization pending": the account keeps trading under
 *   `activeGrant` until the new grant is activated (see `isReauthorizationPending`).
 * - `active`: tradable.
 * - `unavailable`: suspended or the grant expired; reauthorize.
 */
export type TradingAccountStatus =
  | 'provisioning'
  | 'awaiting_owner_approval'
  | 'active'
  | 'unavailable';

export type TradingAction = 'buy' | 'sell' | 'redeem' | 'cancel';

export interface RegisterTradingAccountRequest {
  /** Native Privy wallet ID (not an address). The wallet's `owner_id` must be your owner key. */
  privyWalletId: string;
  /** Max pUSD per buy, base units. Enforced by Predikt before signing. */
  maxBuyAmountPerOrder: string;
  /** ISO 8601 with timezone, e.g. "2026-12-15T12:00:00Z". */
  expiresAt: string;
  /** Register an already deployed Deposit Wallet; omit to let Predikt deploy one. */
  depositWalletAddress?: string;
}

export interface ReauthorizeTradingAccountRequest {
  maxBuyAmountPerOrder: string;
  expiresAt: string;
}

/** Body for `accounts.activate`; exactly what `verifyAndSignApproval` returns. */
export interface ActivateTradingAccountRequest {
  approvalDigest: string;
  /** Base64 DER ECDSA P-256 signatures by the wallet owner key. */
  signatures: string[];
}

/** The Privy wallet update the owner signs (RFC 8785 canonical JSON of this object). */
export interface PrivyWalletUpdatePayload {
  version: 1;
  method: 'PATCH';
  url: string;
  headers: { 'privy-app-id': string; 'privy-request-expiry': string };
  body: { additional_signers: { signer_id: string; override_policy_ids: string[] }[] };
}

/** Owner approval to verify and sign with `verifyAndSignApproval` (`@prediktgg/sdk/server`). */
export interface OwnerApproval {
  authorizationId: string;
  /** Owner key quorum of the wallet. */
  ownerId: string;
  /** Predikt's signer (key quorum) being added or updated. */
  delegatedSignerId: string;
  /** Privy policy attached to Predikt's signer. */
  policyId: string;
  limits: {
    allowedActions: TradingAction[];
    maxBuyAmountPerOrder: string | null;
    expiresAt: string;
  };
  /** sha256 (hex) of the canonical JSON of `signaturePayload`. */
  approvalDigest: string;
  signaturePayload: PrivyWalletUpdatePayload;
  /** The approval must be signed and activated before this time (10 minutes). */
  expiresAt: string;
  /** The Deposit Wallet batch rule does not restrict inner calls. */
  batchCallScope: 'unrestricted';
}

/** Limits and capabilities of a grant. */
export interface TradingGrant {
  maxBuyAmountPerOrder: string | null;
  expiresAt: string;
  /** Policy profile the grant was verified under; null for grants verified before it was recorded. */
  policyProfile: string | null;
  /**
   * Whether the grant lets Predikt sign Polymarket Combos orders. `null` = unknown (approved before
   * profiles were recorded): reauthorize once to enable and record it. `false` = reauthorize.
   */
  combosEnabled: boolean | null;
}

/**
 * A trading account as returned by register, get, reauthorize and activate. Carries both
 * identifiers: `accountId` for direct trading and `depositWalletAddress` for combos, so it can be
 * passed as an `AccountRef` or a `WalletRef`.
 */
export interface TradingAccount {
  /** Null only while `provisioning`. */
  accountId: string | null;
  status: TradingAccountStatus;
  privyWalletId: string;
  /** The Deposit Wallet: users fund this address with pUSD; it holds collateral and positions. */
  depositWalletAddress: string | null;
  /** Limits of the pending grant while awaiting approval, otherwise of the active grant. */
  maxBuyAmountPerOrder: string | null;
  expiresAt: string | null;
  /**
   * The grant Predikt can trade under right now; null when the account cannot trade. Set
   * together with `awaiting_owner_approval` while a re-authorization is pending.
   */
  activeGrant: TradingGrant | null;
  /** Present only while awaiting owner approval, and only from register/reauthorize. */
  approval: OwnerApproval | null;
}

/** Options for `accounts.register`. */
export interface RegisterTradingAccountOptions {
  /** Repeat the request while the Deposit Wallet is being deployed (default true). */
  waitForProvisioning?: boolean;
  /** Delay between repeats (default 3 s). */
  pollIntervalMs?: number;
  /**
   * Stop repeating after this long (default 2 minutes) and return the `provisioning` response;
   * call `register` again later with the same input.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
}

// ─── Portfolio ───────────────────────────────────────────────────────────────

/** One open position. Shares are exact on-chain; prices and values are Polymarket market data. */
export interface PortfolioPosition {
  tokenId: string;
  conditionId: string;
  title: string;
  outcome: string;
  /** Outcome tokens held, base units, read on-chain. */
  shares: string;
  /** Average entry price per share, e.g. "0.1699". */
  avgPrice: string | null;
  currentPrice: string | null;
  /** pUSD base units (approximate). */
  currentValue: string | null;
  /** Unrealized PnL, pUSD base units, signed (approximate). */
  cashPnl: string | null;
  redeemable: boolean;
  endDate: string | null;
  marketSlug: string | null;
}

export interface TradingAccountPortfolio {
  accountId: string;
  status: TradingAccountStatus;
  /** The Deposit Wallet address. */
  tradingAddress: string;
  /** Exact on-chain balances, base units. */
  balances: {
    /** Tradable collateral. */
    pusd: string;
    /** USDC.e sent by mistake; not tradable until wrapped. */
    usdce: string;
  };
  /** Regular positions only (combos: `combos.positions`). Null when Polymarket's service is down. */
  positions: PortfolioPosition[] | null;
  positionsError: string | null;
  asOf: string;
}

export interface RedeemablePosition {
  tokenId: string;
  outcome: string;
  /** Shares held, base units. */
  shares: string;
  /** pUSD paid per share: "1" winning, "0" losing, fractions for split results. */
  payoutPerShare: string;
  /** pUSD paid for these shares, base units. */
  payout: string;
}

export interface RedeemableMarket {
  /** Pass to `trading.redeem`. */
  conditionId: string;
  title: string;
  marketSlug: string | null;
  positions: RedeemablePosition[];
  /** Exactly what redeeming this market pays now, base units. */
  expectedPayout: string;
}

export interface RedeemableMarkets {
  accountId: string;
  markets: RedeemableMarket[];
  asOf: string;
}

// ─── Direct orders ───────────────────────────────────────────────────────────

export type DirectOrderSide = 'buy' | 'sell' | 'redeem';

/** `integrator`: your request. `polymarket_auto`: a redemption Polymarket made on its own. */
export type DirectOrderSource = 'integrator' | 'polymarket_auto';

/**
 * Final: `rejected` (no funds moved), `filled` and `redeemed` (once their amounts are set).
 * Not final: `pending`, `submitting`, `submitted`, `unknown` — keep funds reserved and poll;
 * never place a replacement for an `unknown` order. See `isDirectOrderFinal`.
 */
export type DirectOrderStatus =
  | 'pending'
  | 'submitting'
  | 'submitted'
  | 'filled'
  | 'redeemed'
  | 'rejected'
  | 'unknown';

export interface DirectBuyOrderRequest {
  /** Polymarket CLOB outcome token ID. */
  tokenId: string;
  /** All-in pUSD budget including Polymarket's fee, base units; at most `maxBuyAmountPerOrder`. */
  amount: string;
  /** Percent above the best ask, "0.1"–"50" (default "5"). */
  slippagePercent?: string;
  /** 8–128 chars `[A-Za-z0-9_-]`. Repeating it returns the original order. */
  idempotencyKey: string;
}

export interface DirectSellOrderRequest {
  tokenId: string;
  /** Shares to sell, base units, or "all". Polymarket's minimum is usually 5 shares. */
  shares: string;
  /** Percent below the best bid, "0.1"–"50" (default "5"). */
  slippagePercent?: string;
  idempotencyKey: string;
}

export interface DirectRedeemRequest {
  /** Resolved market; all held outcomes are redeemed. */
  conditionId: string;
  idempotencyKey: string;
}

export type DirectOrderFeeType =
  | 'polymarket_exchange_fee'
  | 'polymarket_builder_fee'
  | 'predikt_fee'
  | 'network_gas';

export type DirectOrderFeeChargedSource =
  | 'onchain_order_filled_event'
  | 'pending'
  | 'not_applicable';

export interface DirectOrderFeeItem {
  type: DirectOrderFeeType;
  /** Exchange fee basis: `onchain_cap` | `market_rate` | `fallback_estimate`. */
  basis: string | null;
  rateBps: string | null;
  /** Set aside (buy) or expected (sell) before the order, base units. */
  reserved: string;
  /** Actually charged, base units; null until settlement is confirmed. */
  charged: string | null;
  chargedSource: DirectOrderFeeChargedSource;
  exceededReserve: boolean;
  explanation: string;
}

export interface DirectOrderFees {
  currency: 'pUSD';
  unit: 'base units (6 decimals)';
  items: DirectOrderFeeItem[];
  totalReserved: string;
  totalCharged: string | null;
  exceededReserve: boolean;
}

export interface DirectRedeemedPosition {
  tokenId: string;
  outcome: string;
  /** Shares redeemed, base units. */
  shares: string;
}

export interface DirectOrder {
  orderId: string;
  accountId: string;
  side: DirectOrderSide;
  source: DirectOrderSource;
  status: DirectOrderStatus;
  /** Buy/sell outcome token; null for redemptions. */
  tokenId: string | null;
  /** Redemptions only. */
  conditionId: string | null;
  redeemedPositions: DirectRedeemedPosition[] | null;
  /** Buy: requested pUSD. Sell: shares requested. Redeem: shares held. Base units. */
  amount: string;
  /** Buy: pUSD planned for shares after the fee reserve. */
  principal: string | null;
  slippagePercent: string | null;
  /** Best ask (buy) or bid (sell) when priced. */
  bestPriceAtOrder: string | null;
  /** Worst fill price allowed. */
  limitPrice: string | null;
  clobOrderId: string | null;
  /** Buy: total pUSD debited (principal filled + fees). Debit the user this, not `amount`. */
  spentAmount: string | null;
  /** Sell: net pUSD credited. Redeem: payout. */
  receivedAmount: string | null;
  /** Exact shares bought/sold. */
  filledShares: string | null;
  transactionHashes: string[];
  /** Why it was rejected or is pending, e.g. `FOK_NOT_FILLED`, `RECONCILE_EXHAUSTED`. */
  reasonCode: string | null;
  fees: DirectOrderFees | null;
}

export interface ListDirectOrderChangesQuery {
  /** `nextCursor` from the previous page; omit to start from the oldest change. */
  cursor?: string;
  /** 1–100 (default 50). */
  limit?: number;
  side?: DirectOrderSide;
  source?: DirectOrderSource;
}

/** One page of the account's order change feed, oldest change first. */
export interface DirectOrderChangesPage {
  /** The same order can appear more than once; process by `orderId`, repeat-safe. */
  orders: DirectOrder[];
  /** Store it and pass it as `cursor` next time. Unchanged when the page is empty. */
  nextCursor: string | null;
  /** More changes are available right now. */
  hasMore: boolean;
}
