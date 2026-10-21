import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDirectOrderFinal } from '../src/index.js';
import { approvalAccount, directOrder } from './fixtures.js';
import { ACCOUNT_ID, apiError, json, mockFetch, sdk } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = `/direct/trading-accounts/${ACCOUNT_ID}`;

describe('trading writes', () => {
  it('buys, sells and redeems with the documented bodies', async () => {
    const { calls } = mockFetch(() => json(200, directOrder()));
    const account = approvalAccount();
    const client = sdk();
    await client.trading.buy(account, { tokenId: '5511', amount: '2000000', slippagePercent: '5', idempotencyKey: 'casino-order-0001' });
    await client.trading.sell(ACCOUNT_ID, { tokenId: '5511', shares: 'all', idempotencyKey: 'casino-order-0002' });
    await client.trading.redeem(account, { conditionId: `0x${'ab'.repeat(32)}`, idempotencyKey: 'casino-redeem-0001' });
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ['POST', `${BASE}/orders/buy`, { tokenId: '5511', amount: '2000000', slippagePercent: '5', idempotencyKey: 'casino-order-0001' }],
      ['POST', `${BASE}/orders/sell`, { tokenId: '5511', shares: 'all', idempotencyKey: 'casino-order-0002' }],
      ['POST', `${BASE}/redeem`, { conditionId: `0x${'ab'.repeat(32)}`, idempotencyKey: 'casino-redeem-0001' }],
    ]);
  });

  it('withdraws an amount or "all" with the documented body', async () => {
    const { calls } = mockFetch(() =>
      json(200, directOrder({ side: 'withdraw', status: 'withdrawn', tokenId: null, amount: '3000000' })),
    );
    const client = sdk();
    const withdrawn = await client.trading.withdraw(approvalAccount(), { amount: '3000000', idempotencyKey: 'withdraw-test-0001' });
    await client.trading.withdraw(ACCOUNT_ID, { amount: 'all', idempotencyKey: 'withdraw-test-0002', extra: 1 } as never);
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ['POST', `${BASE}/withdraw`, { amount: '3000000', idempotencyKey: 'withdraw-test-0001' }],
      ['POST', `${BASE}/withdraw`, { amount: 'all', idempotencyKey: 'withdraw-test-0002' }],
    ]);
    expect(isDirectOrderFinal(withdrawn)).toBe(true);
  });

  it('retries a withdrawal after a network error with the same idempotency key', async () => {
    let attempt = 0;
    const { calls } = mockFetch(() => {
      if (attempt++ === 0) throw new TypeError('fetch failed');
      return json(200, directOrder({ side: 'withdraw', status: 'withdrawn', tokenId: null }));
    });
    await sdk({ retry: { baseDelayMs: 1 } }).trading.withdraw(ACCOUNT_ID, { amount: 'all', idempotencyKey: 'withdraw-test-0003' });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.body)).toEqual([
      { amount: 'all', idempotencyKey: 'withdraw-test-0003' },
      { amount: 'all', idempotencyKey: 'withdraw-test-0003' },
    ]);
  });

  it('surfaces NOTHING_TO_WITHDRAW as a typed 400 without retrying', async () => {
    const { calls } = mockFetch(() => apiError(400, 'NOTHING_TO_WITHDRAW'));
    await expect(sdk().trading.withdraw(ACCOUNT_ID, { amount: 'all', idempotencyKey: 'withdraw-test-0004' })).rejects.toMatchObject({
      status: 400,
      code: 'NOTHING_TO_WITHDRAW',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('order reads', () => {
  it('gets an order and lists changes with filters', async () => {
    const { calls } = mockFetch((call) =>
      call.url.pathname.endsWith('/orders') ? json(200, { orders: [], nextCursor: 'c1', hasMore: false }) : json(200, directOrder()),
    );
    const client = sdk();
    await client.trading.getOrder(ACCOUNT_ID, 'o-1');
    await client.trading.listOrderChanges(ACCOUNT_ID, { cursor: 'c0', limit: 50, side: 'redeem', source: 'polymarket_auto' });
    await client.trading.listOrderChanges(ACCOUNT_ID);
    expect(calls[0].url.pathname).toBe(`${BASE}/orders/o-1`);
    expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({
      cursor: 'c0',
      limit: '50',
      side: 'redeem',
      source: 'polymarket_auto',
    });
    expect(calls[2].url.search).toBe('');
  });

  it('iterates change-feed pages while hasMore, starting from the stored cursor', async () => {
    const pages: Record<string, unknown> = {
      c0: { orders: [directOrder({ orderId: 'a' })], nextCursor: 'c1', hasMore: true },
      c1: { orders: [directOrder({ orderId: 'b' })], nextCursor: 'c2', hasMore: false },
    };
    const { calls } = mockFetch((call) => json(200, pages[call.url.searchParams.get('cursor') ?? '']));
    const seen: string[] = [];
    let stored = 'c0';
    for await (const page of sdk().trading.iterateOrderChanges(ACCOUNT_ID, { cursor: stored })) {
      seen.push(...page.orders.map((o) => o.orderId));
      stored = page.nextCursor ?? stored;
    }
    expect(seen).toEqual(['a', 'b']);
    expect(stored).toBe('c2');
    expect(calls).toHaveLength(2);
  });

  it('stops iterating if the cursor does not advance', async () => {
    const { calls } = mockFetch(() => json(200, { orders: [], nextCursor: 'same', hasMore: true }));
    const pages = [];
    for await (const page of sdk().trading.iterateOrderChanges(ACCOUNT_ID, { cursor: 'same' })) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('isDirectOrderFinal', () => {
  it.each([
    [directOrder({ status: 'rejected', spentAmount: null }), true],
    [directOrder({ status: 'filled' }), true],
    [directOrder({ status: 'filled', spentAmount: null }), false],
    [directOrder({ side: 'sell', status: 'filled', receivedAmount: '1939700' }), true],
    [directOrder({ side: 'sell', status: 'filled', receivedAmount: null }), false],
    [directOrder({ side: 'redeem', status: 'redeemed', receivedAmount: '2836735' }), true],
    [directOrder({ side: 'withdraw', status: 'withdrawn', tokenId: null, spentAmount: null }), true],
    [directOrder({ side: 'withdraw', status: 'submitting', tokenId: null, spentAmount: null }), false],
    [directOrder({ status: 'submitted' }), false],
    [directOrder({ status: 'unknown' }), false],
    [directOrder({ status: 'pending' }), false],
    [directOrder({ status: 'submitting' }), false],
  ])('%#', (order, expected) => {
    expect(isDirectOrderFinal(order)).toBe(expected);
  });
});

describe('trading.waitForOrder', () => {
  it('polls until filled with amounts', async () => {
    const snapshots = [
      directOrder({ status: 'submitted', spentAmount: null }),
      directOrder({ status: 'filled', spentAmount: null }),
      directOrder({ status: 'filled', spentAmount: '1940000' }),
    ];
    const { calls } = mockFetch(() => json(200, snapshots.shift()));
    const order = await sdk().trading.waitForOrder(ACCOUNT_ID, 'o-1', { intervalMs: 1 });
    expect(order.spentAmount).toBe('1940000');
    expect(calls).toHaveLength(3);
  });

  it('keeps polling through transient failures, but throws other errors', async () => {
    const responses = [
      () => apiError(502, 'BAD_GATEWAY'),
      () => Promise.reject(new TypeError('fetch failed')),
      () => json(200, directOrder({ status: 'filled' })),
    ];
    const pending = directOrder({ status: 'submitted', spentAmount: null });
    mockFetch(() => responses.shift()!());
    const order = await sdk({ retry: false }).trading.waitForOrder(ACCOUNT_ID, pending, { intervalMs: 1 });
    expect(order.status).toBe('filled');

    mockFetch(() => apiError(404, 'ORDER_NOT_FOUND'));
    await expect(sdk().trading.waitForOrder(ACCOUNT_ID, pending, { intervalMs: 1 })).rejects.toMatchObject({ status: 404 });
  });

  it('returns a final order without any request', async () => {
    const { calls } = mockFetch(() => json(200, directOrder()));
    const order = directOrder({ status: 'rejected', reasonCode: 'FOK_NOT_FILLED' });
    expect(await sdk().trading.waitForOrder(ACCOUNT_ID, order)).toBe(order);
    expect(calls).toHaveLength(0);
  });

  it('returns the latest (still pending) snapshot on timeout instead of failing', async () => {
    mockFetch(() => json(200, directOrder({ status: 'unknown', spentAmount: null })));
    const order = await sdk().trading.waitForOrder(ACCOUNT_ID, directOrder({ status: 'unknown' }), {
      intervalMs: 5,
      timeoutMs: 30,
    });
    expect(order.status).toBe('unknown');
  });
});
