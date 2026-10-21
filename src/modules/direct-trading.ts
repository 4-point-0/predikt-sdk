import { HttpClient, QueryParams } from '../http-client.js';
import {
  AccountRef,
  DirectBuyOrderRequest,
  DirectOrder,
  DirectOrderChangesPage,
  DirectRedeemRequest,
  DirectSellOrderRequest,
  DirectWithdrawRequest,
  ListDirectOrderChangesQuery,
} from '../types/direct.js';
import { isDirectOrderFinal } from '../utils/order-status.js';
import { pollUntil, WaitForOrderOptions } from '../utils/poll.js';
import { accountIdOf, pathSegment } from '../utils/refs.js';

const WAIT_DEFAULTS = { timeoutMs: 120_000, intervalMs: 2_000, maxIntervalMs: 30_000 };

/**
 * Fill-or-kill trading of regular Polymarket markets on a trading account's Deposit Wallet.
 * Every write carries an `idempotencyKey`: repeating it returns the original order, so the SDK
 * retries transient failures with the same key. After a `rejected` order, use a NEW key.
 */
export class TradingClient {
  constructor(private readonly http: HttpClient) {}

  /** Buys with an all-in pUSD budget. Debit the user `spentAmount` of the filled order. */
  async buy(account: AccountRef, body: DirectBuyOrderRequest): Promise<DirectOrder> {
    return this.write(account, '/orders/buy', {
      tokenId: body.tokenId,
      amount: body.amount,
      slippagePercent: body.slippagePercent,
      idempotencyKey: body.idempotencyKey,
    });
  }

  /** Sells shares (or "all"). Credit the user `receivedAmount` (net of fees). */
  async sell(account: AccountRef, body: DirectSellOrderRequest): Promise<DirectOrder> {
    return this.write(account, '/orders/sell', {
      tokenId: body.tokenId,
      shares: body.shares,
      slippagePercent: body.slippagePercent,
      idempotencyKey: body.idempotencyKey,
    });
  }

  /**
   * Redeems every held outcome of a resolved market. Fallback only: Polymarket usually redeems
   * on its own (`polymarket_auto` orders in `listOrderChanges`).
   */
  async redeem(account: AccountRef, body: DirectRedeemRequest): Promise<DirectOrder> {
    return this.write(account, '/redeem', {
      conditionId: body.conditionId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  /**
   * Moves pUSD from the Deposit Wallet to the account's own Privy wallet (the destination is
   * fixed by Predikt). Returns an order with `side: 'withdraw'`; `withdrawn` means the transfer
   * settled and `amount` is the exact pUSD moved. Gasless, no fees.
   */
  async withdraw(account: AccountRef, body: DirectWithdrawRequest): Promise<DirectOrder> {
    return this.write(account, '/withdraw', {
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
    });
  }

  async getOrder(account: AccountRef, orderId: string): Promise<DirectOrder> {
    const path = `${this.base(account)}/orders/${pathSegment(orderId)}`;
    return (await this.http.request<DirectOrder>('GET', path, { idempotent: true })).data;
  }

  /**
   * One page of the account's order change feed (new orders, status changes, automatic
   * redemptions), oldest change first. Store `nextCursor`; if `hasMore`, call again right away.
   */
  async listOrderChanges(
    account: AccountRef,
    query: ListDirectOrderChangesQuery = {},
  ): Promise<DirectOrderChangesPage> {
    const path = `${this.base(account)}/orders`;
    const params: QueryParams = {
      cursor: query.cursor,
      limit: query.limit,
      side: query.side,
      source: query.source,
    };
    return (await this.http.request<DirectOrderChangesPage>('GET', path, { query: params, idempotent: true }))
      .data;
  }

  /**
   * Yields change-feed pages from `query.cursor` until no more changes are available now.
   * Persist each page's `nextCursor` after processing it, and resume from it next time.
   */
  async *iterateOrderChanges(
    account: AccountRef,
    query: ListDirectOrderChangesQuery = {},
  ): AsyncGenerator<DirectOrderChangesPage, void, undefined> {
    let cursor = query.cursor;
    for (;;) {
      const page = await this.listOrderChanges(account, { ...query, cursor });
      yield page;
      if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    }
  }

  /**
   * Polls the order until it is final (`isDirectOrderFinal`) or `timeoutMs` (default 2 min)
   * passes, and returns the latest snapshot. A non-final result is NOT a failure: keep funds
   * reserved and poll again later (`submitted`/`unknown` orders are reconciled by Predikt over
   * minutes to hours). Never place a replacement for an `unknown` order.
   */
  async waitForOrder(
    account: AccountRef,
    order: string | DirectOrder,
    options: WaitForOrderOptions = {},
  ): Promise<DirectOrder> {
    const orderId = typeof order === 'string' ? order : order.orderId;
    return pollUntil(
      () => this.getOrder(account, orderId),
      isDirectOrderFinal,
      typeof order === 'string' ? undefined : order,
      options,
      WAIT_DEFAULTS,
    );
  }

  private base(account: AccountRef): string {
    return `/direct/trading-accounts/${pathSegment(accountIdOf(account))}`;
  }

  private async write(account: AccountRef, path: string, body: object): Promise<DirectOrder> {
    const { data } = await this.http.request<DirectOrder>('POST', `${this.base(account)}${path}`, {
      body,
      idempotent: true,
    });
    return data;
  }
}
