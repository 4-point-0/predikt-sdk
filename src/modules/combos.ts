import { PrediktConflictError } from '../error.js';
import { HttpClient, QueryParams } from '../http-client.js';
import {
  ComboActivity,
  ComboActivityQuery,
  ComboBuyRequest,
  ComboDataApiPage,
  ComboMarket,
  ComboMarketsPage,
  ComboMarketsQuery,
  ComboOrder,
  ComboOrderDirection,
  ComboOrdersPage,
  ComboOrdersQuery,
  ComboPosition,
  ComboPositionsQuery,
  ComboQuote,
  ComboQuoteRequest,
  ComboRedeemRequest,
  ComboSellRequest,
} from '../types/combos.js';
import { isComboOrderFinal } from '../utils/order-status.js';
import { pollUntil, WaitForOrderOptions } from '../utils/poll.js';
import { pathSegment, walletOf } from '../utils/refs.js';
import { toBaseUnits } from '../utils/units.js';

const WAIT_DEFAULTS = { timeoutMs: 120_000, intervalMs: 2_000, maxIntervalMs: 15_000 };

/** What the returned order must match for a request; anything else means a reused clientOrderId. */
interface ExpectedOrder {
  direction: ComboOrderDirection;
  wallet: string;
  comboConditionId?: string;
  requestedAmount?: string;
  requestedShares?: string;
  limitPrice?: string;
  legs?: ComboBuyRequest['legs'];
}

/**
 * Polymarket Combos (parlays): 2–50 legs, pays 1 pUSD per share only if every leg wins.
 * Accounts are identified by their Deposit Wallet (`wallet`), which must be an active trading
 * account of the calling integrator with a policy-v4 grant. Polymarket allows 15 RFQs per minute
 * per wallet (`429` above that; back off).
 */
export class CombosClient {
  constructor(private readonly http: HttpClient) {}

  /** One page of combo-eligible markets, ordered by volume. */
  async listMarkets(query: ComboMarketsQuery = {}): Promise<ComboMarketsPage> {
    return this.get<ComboMarketsPage>('/combos/markets', { limit: query.limit, cursor: query.cursor });
  }

  /** Every combo-eligible market from `query.cursor` on, page by page. */
  async *iterateMarkets(query: ComboMarketsQuery = {}): AsyncGenerator<ComboMarket, void, undefined> {
    let cursor = query.cursor;
    for (;;) {
      const page = await this.listMarkets({ ...query, cursor });
      yield* page.markets;
      if (!page.nextCursor || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    }
  }

  /** Indicative price from leg prices (no trading, no RFQ). */
  async quote(body: ComboQuoteRequest): Promise<ComboQuote> {
    return this.post<ComboQuote>('/combos/quote', {
      legs: body.legs.map(({ marketId, outcome }) => ({ marketId, outcome })),
      amount: body.amount,
    });
  }

  /**
   * Buys a ticket in full or not at all. Waits up to ~15 s for the fill and returns `FILLED`,
   * `FAILED` or `EXECUTING` (then use `waitForOrder`). Keep `comboConditionId` to sell/redeem.
   * Debit the user `amount` of the FILLED order.
   */
  async buy(body: ComboBuyRequest): Promise<ComboOrder> {
    const wallet = walletOf(body.wallet);
    const legs = body.legs.map(({ marketId, outcome }) => ({ marketId, outcome }));
    const order = await this.post<ComboOrder>('/combos/buy', {
      wallet,
      legs,
      amount: body.amount,
      maxPrice: body.maxPrice,
      clientOrderId: body.clientOrderId,
    });
    return this.checkSameOrder(order, body.clientOrderId, {
      direction: 'BUY',
      wallet,
      requestedAmount: body.amount,
      limitPrice: body.maxPrice,
      legs,
    });
  }

  /** Cashes out shares of a combo bought through Predikt. Credit the user `amount` of the FILLED order. */
  async sell(body: ComboSellRequest): Promise<ComboOrder> {
    const wallet = walletOf(body.wallet);
    const order = await this.post<ComboOrder>('/combos/sell', {
      wallet,
      comboConditionId: body.comboConditionId,
      shares: body.shares,
      minPrice: body.minPrice,
      clientOrderId: body.clientOrderId,
      allowPartialFill: body.allowPartialFill,
    });
    return this.checkSameOrder(order, body.clientOrderId, {
      direction: 'SELL',
      wallet,
      comboConditionId: body.comboConditionId,
      requestedShares: body.shares,
      limitPrice: body.minPrice,
    });
  }

  /**
   * Fallback payout of a resolved combo. Normally Polymarket pays out on its own and Predikt
   * records a `REDEEM`/`POLYMARKET_AUTO` order. `FAILED` with `COMBO_ALREADY_REDEEMED` means
   * Polymarket paid first. Credit payouts from FILLED REDEEM orders of both sources, once per id.
   */
  async redeem(body: ComboRedeemRequest): Promise<ComboOrder> {
    const wallet = walletOf(body.wallet);
    const order = await this.post<ComboOrder>('/combos/redeem', {
      wallet,
      comboConditionId: body.comboConditionId,
      clientOrderId: body.clientOrderId,
    });
    return this.checkSameOrder(order, body.clientOrderId, {
      direction: 'REDEEM',
      wallet,
      comboConditionId: body.comboConditionId,
    });
  }

  async getOrder(id: string): Promise<ComboOrder> {
    return this.get<ComboOrder>(`/combos/orders/${pathSegment(id)}`);
  }

  /**
   * Predikt's combo orders (buys, cash-outs, payouts of both sources), newest first. Not a change
   * feed: poll pending orders with `getOrder`; detect new automatic payouts by listing and
   * processing unseen ids.
   */
  async listOrders(query: ComboOrdersQuery = {}): Promise<ComboOrdersPage> {
    return this.get<ComboOrdersPage>('/combos/orders', {
      wallet: query.wallet === undefined ? undefined : walletOf(query.wallet),
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Every order matching `query`, newest first, page by page from `query.offset`. New orders
   * arriving meanwhile can repeat an order across pages; process by `id`.
   */
  async *iterateOrders(query: ComboOrdersQuery = {}): AsyncGenerator<ComboOrder, void, undefined> {
    const limit = query.limit ?? 100;
    let offset = query.offset ?? 0;
    for (;;) {
      const page = await this.listOrders({ ...query, limit, offset });
      yield* page.data;
      if (!page.pagination.hasNext || page.data.length === 0) return;
      offset += page.data.length;
    }
  }

  /**
   * Polls a combo order until `FILLED` or `FAILED`, or until `timeoutMs` (default 2 min), and
   * returns the latest snapshot. A non-final result is NOT a failure: keep funds reserved and
   * poll again later. Never place a replacement for an `EXECUTING` order.
   */
  async waitForOrder(order: string | ComboOrder, options: WaitForOrderOptions = {}): Promise<ComboOrder> {
    const id = typeof order === 'string' ? order : order.id;
    return pollUntil(
      () => this.getOrder(id),
      isComboOrderFinal,
      typeof order === 'string' ? undefined : order,
      options,
      WAIT_DEFAULTS,
    );
  }

  /** Polymarket's combo positions of the wallet, passed through unchanged (snake_case). */
  async positions(query: ComboPositionsQuery): Promise<ComboDataApiPage<ComboPosition>> {
    return this.get<ComboDataApiPage<ComboPosition>>('/combos/positions', {
      wallet: walletOf(query.wallet),
      status: query.status,
      condition: query.condition,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** Polymarket's combo activity of the wallet, passed through. Not for accounting (no cash-outs). */
  async activity(query: ComboActivityQuery): Promise<ComboDataApiPage<ComboActivity>> {
    return this.get<ComboDataApiPage<ComboActivity>>('/combos/activity', {
      wallet: walletOf(query.wallet),
      condition: query.condition,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  private async get<T>(path: string, query?: QueryParams): Promise<T> {
    return (await this.http.request<T>('GET', path, { query, idempotent: true })).data;
  }

  private async post<T>(path: string, body: object): Promise<T> {
    return (await this.http.request<T>('POST', path, { body, idempotent: true })).data;
  }

  /**
   * The API answers a clientOrderId reused for a different order with `409
   * COMBO_CLIENT_ORDER_ID_REUSED`. Older API versions returned the existing order instead, so the
   * SDK compares it too and throws the same error.
   */
  private checkSameOrder(order: ComboOrder, clientOrderId: string, expected: ExpectedOrder): ComboOrder {
    const mismatch = [
      order.direction !== expected.direction && 'direction',
      order.wallet.toLowerCase() !== expected.wallet.toLowerCase() && 'wallet',
      expected.comboConditionId !== undefined &&
        normalizeConditionId(order.comboConditionId) !== normalizeConditionId(expected.comboConditionId) &&
        'comboConditionId',
      expected.requestedAmount !== undefined &&
        !sameInteger(order.requestedAmount, expected.requestedAmount) &&
        'amount',
      expected.requestedShares !== undefined &&
        !sameInteger(order.requestedShares, expected.requestedShares) &&
        'shares',
      expected.limitPrice !== undefined && !samePrice(order.limitPrice, expected.limitPrice) && 'price',
      expected.legs !== undefined && !sameLegs(order.legs, expected.legs) && 'legs',
    ].filter((field): field is string => typeof field === 'string');
    if (mismatch.length === 0) return order;
    throw new PrediktConflictError(
      `clientOrderId "${clientOrderId}" already belongs to combo order ${order.id} with a different ` +
        `${mismatch.join(', ')}. No new order was placed; use a new clientOrderId.`,
      'COMBO_CLIENT_ORDER_ID_REUSED',
      { orderId: order.id, mismatch, raisedBy: 'sdk' },
    );
  }
}

/** Combo condition ids are bytes31; the RFQ API right-pads them to bytes32. */
function normalizeConditionId(id: string | null): string | null {
  if (id === null) return null;
  const hex = id.toLowerCase();
  return hex.length === 66 && hex.endsWith('00') ? hex.slice(0, 64) : hex;
}

function sameInteger(actual: string | null, expected: string): boolean {
  try {
    return actual !== null && BigInt(actual) === BigInt(expected);
  } catch {
    return actual === expected;
  }
}

/** Prices are echoed as normalized decimals ("0.30" → "0.3"). */
function samePrice(actual: string | null, expected: string): boolean {
  try {
    return actual !== null && toBaseUnits(actual) === toBaseUnits(expected);
  } catch {
    return actual === expected;
  }
}

function sameLegs(actual: ComboOrder['legs'], expected: ComboBuyRequest['legs']): boolean {
  const key = (leg: { marketId: string; outcome: number }) => `${leg.marketId}:${leg.outcome}`;
  const wanted = new Set(expected.map(key));
  return actual.length === expected.length && actual.every((leg) => wanted.has(key(leg)));
}
