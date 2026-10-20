import { afterEach, describe, expect, it, vi } from 'vitest';
import { isComboOrderFinal, Outcome, PrediktConflictError } from '../src/index.js';
import { approvalAccount, comboOrder } from './fixtures.js';
import { json, mockFetch, sdk, WALLET } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LEGS = [
  { marketId: '682708', outcome: 0 as const },
  { marketId: '1090496', outcome: 1 as const },
];
const CONDITION = '0x03d3cd957beec0a5317055175d094724d40000000000000000000000000000';

describe('combo markets and quotes', () => {
  it('lists a page and iterates all markets across cursors', async () => {
    const market = (marketId: string) => ({ marketId, conditionId: '0x', slug: '', title: '', outcomes: [], prices: [], positionIds: [], image: null, volume: null, tags: [] });
    const { calls } = mockFetch((call) =>
      call.url.searchParams.get('cursor') === 'n1'
        ? json(200, { markets: [market('3')], nextCursor: null })
        : json(200, { markets: [market('1'), market('2')], nextCursor: 'n1' }),
    );
    const client = sdk();
    const page = await client.combos.listMarkets({ limit: 2 });
    expect(page.nextCursor).toBe('n1');
    const ids: string[] = [];
    for await (const m of client.combos.iterateMarkets({ limit: 2 })) ids.push(m.marketId);
    expect(ids).toEqual(['1', '2', '3']);
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ limit: '2' });
    expect(Object.fromEntries(calls[2].url.searchParams)).toEqual({ limit: '2', cursor: 'n1' });
  });

  it('quotes with legs (accepting the Outcome enum)', async () => {
    const { calls } = mockFetch(() => json(200, { indicativePrice: '0.366818', estimatedShares: '2726143', potentialPayout: '2726143', legs: [] }));
    const quote = await sdk().combos.quote({
      legs: [{ marketId: '682708', outcome: Outcome.YES }, { marketId: '1090496', outcome: Outcome.NO }],
      amount: '1000000',
    });
    expect(quote.indicativePrice).toBe('0.366818');
    expect([calls[0].method, calls[0].url.pathname, calls[0].body]).toEqual(['POST', '/combos/quote', { legs: LEGS, amount: '1000000' }]);
  });
});

describe('combo trading', () => {
  it('buys with the account object as wallet', async () => {
    const { calls } = mockFetch(() => json(201, comboOrder()));
    const order = await sdk().combos.buy({
      wallet: approvalAccount(),
      legs: LEGS,
      amount: '2000000',
      maxPrice: '0.41',
      clientOrderId: 'casino-combo-0001',
    });
    expect(order.status).toBe('FILLED');
    expect([calls[0].method, calls[0].url.pathname, calls[0].body]).toEqual([
      'POST',
      '/combos/buy',
      { wallet: WALLET, legs: LEGS, amount: '2000000', maxPrice: '0.41', clientOrderId: 'casino-combo-0001' },
    ]);
  });

  it('sells and redeems', async () => {
    const sell = comboOrder({ direction: 'SELL', requestedAmount: null, requestedShares: '5054026', limitPrice: '0.3', clientOrderId: 'casino-combo-sell-0001' });
    const redeem = comboOrder({ direction: 'REDEEM', requestedAmount: null, requestedShares: '5054026', limitPrice: null, clientOrderId: 'casino-combo-redeem-0001' });
    const { calls } = mockFetch((call) => json(201, call.url.pathname === '/combos/sell' ? sell : redeem));
    const client = sdk();
    await client.combos.sell({ wallet: WALLET, comboConditionId: CONDITION, shares: '5054026', minPrice: '0.30', clientOrderId: 'casino-combo-sell-0001' });
    await client.combos.redeem({ wallet: WALLET, comboConditionId: CONDITION, clientOrderId: 'casino-combo-redeem-0001' });
    expect(calls[0].body).toEqual({ wallet: WALLET, comboConditionId: CONDITION, shares: '5054026', minPrice: '0.30', clientOrderId: 'casino-combo-sell-0001' });
    expect(calls[1].body).toEqual({ wallet: WALLET, comboConditionId: CONDITION, clientOrderId: 'casino-combo-redeem-0001' });
  });

  it('accepts the bytes32 form of the condition id and checksummed wallets', async () => {
    const sell = comboOrder({ direction: 'SELL', requestedAmount: null, requestedShares: '5054026', limitPrice: '0.3', comboConditionId: CONDITION });
    mockFetch(() => json(201, sell));
    await expect(
      sdk().combos.sell({
        wallet: '0xcD466971e81fD723dbeef85dD37Cb3993ff89B38',
        comboConditionId: `${CONDITION.toUpperCase().replace('0X', '0x')}00`,
        shares: '5054026',
        minPrice: '0.3',
        clientOrderId: 'k',
        allowPartialFill: true,
      }),
    ).resolves.toEqual(sell);
  });

  describe('clientOrderId reused for a different order', () => {
    it.each([
      ['another wallet', { wallet: '0x0000000000000000000000000000000000000001' }],
      ['another amount', { requestedAmount: '3000000' }],
      ['other legs', { legs: [comboOrder().legs[0], { ...comboOrder().legs[1], outcome: 0 as const }] }],
      ['another direction', { direction: 'SELL' as const }],
      ['another max price', { limitPrice: '0.5' }],
    ])('buy returning an order with %s throws 409', async (_name, overrides) => {
      mockFetch(() => json(201, comboOrder(overrides)));
      const error = await sdk()
        .combos.buy({ wallet: WALLET, legs: LEGS, amount: '2000000', maxPrice: '0.41', clientOrderId: 'casino-combo-0001' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrediktConflictError);
      expect(error).toMatchObject({ code: 'COMBO_CLIENT_ORDER_ID_REUSED', orderId: comboOrder().id, details: { raisedBy: 'sdk' } });
    });

    it('passes the API\'s own 409 through', async () => {
      mockFetch(() => json(409, { statusCode: 409, code: 'COMBO_CLIENT_ORDER_ID_REUSED', message: 'reused', details: { orderId: 'o-9', mismatch: ['amount'] } }));
      const error = await sdk()
        .combos.buy({ wallet: WALLET, legs: LEGS, amount: '1', maxPrice: '0.41', clientOrderId: 'k' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PrediktConflictError);
      expect(error).toMatchObject({ code: 'COMBO_CLIENT_ORDER_ID_REUSED', orderId: 'o-9' });
    });

    it('sell returning another combo throws 409', async () => {
      mockFetch(() => json(201, comboOrder({ direction: 'SELL', requestedShares: '5054026', comboConditionId: '0xother' })));
      await expect(
        sdk().combos.sell({ wallet: WALLET, comboConditionId: CONDITION, shares: '5054026', minPrice: '0.3', clientOrderId: 'k' }),
      ).rejects.toMatchObject({ code: 'COMBO_CLIENT_ORDER_ID_REUSED' });
    });

    it('a matching FAILED order is returned as is (retry with a new key)', async () => {
      const failed = comboOrder({ status: 'FAILED', error: { code: 'NO_QUOTES', message: null }, shares: null, amount: null });
      mockFetch(() => json(201, failed));
      const order = await sdk().combos.buy({ wallet: WALLET, legs: [...LEGS].reverse(), amount: '2000000', maxPrice: '0.41', clientOrderId: 'k' });
      expect(order.error?.code).toBe('NO_QUOTES');
    });
  });
});

describe('combo reads', () => {
  it('reads orders, positions and activity with filters', async () => {
    const { calls } = mockFetch((call) =>
      call.url.pathname === '/combos/orders'
        ? json(200, { data: [], pagination: { currentPage: 1, itemsPerPage: 20, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } })
        : json(200, call.url.pathname.startsWith('/combos/orders/') ? comboOrder() : { data: [] }),
    );
    const client = sdk();
    const account = approvalAccount();
    await client.combos.getOrder('d996c1c8');
    await client.combos.listOrders({ wallet: account, status: 'FILLED', limit: 20, offset: 0 });
    await client.combos.listOrders();
    await client.combos.positions({ wallet: account, status: 'REDEEMABLE', condition: CONDITION, limit: 50, cursor: 'p' });
    await client.combos.activity({ wallet: WALLET, condition: CONDITION });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`)).toEqual([
      'GET /combos/orders/d996c1c8',
      `GET /combos/orders?wallet=${WALLET}&status=FILLED&limit=20&offset=0`,
      'GET /combos/orders',
      `GET /combos/positions?wallet=${WALLET}&status=REDEEMABLE&condition=${CONDITION}&limit=50&cursor=p`,
      `GET /combos/activity?wallet=${WALLET}&condition=${CONDITION}`,
    ]);
  });

  it('iterates orders across offset pages', async () => {
    const page = (ids: string[], hasNext: boolean) => ({
      data: ids.map((id) => comboOrder({ id })),
      pagination: { currentPage: 1, itemsPerPage: 2, totalItems: 3, totalPages: 2, hasNext, hasPrev: false },
    });
    const { calls } = mockFetch((call) => json(200, call.url.searchParams.get('offset') === '0' ? page(['a', 'b'], true) : page(['c'], false)));
    const ids: string[] = [];
    for await (const order of sdk().combos.iterateOrders({ wallet: WALLET, limit: 2 })) ids.push(order.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '2']);
  });

  it('waits for an EXECUTING order to finish', async () => {
    const snapshots = [comboOrder({ status: 'EXECUTING' }), comboOrder({ status: 'FILLED' })];
    const { calls } = mockFetch(() => json(200, snapshots.shift()));
    const order = await sdk().combos.waitForOrder(comboOrder({ status: 'PENDING' }), { intervalMs: 1 });
    expect(order.status).toBe('FILLED');
    expect(calls).toHaveLength(2);
    expect(isComboOrderFinal(order)).toBe(true);
    expect(isComboOrderFinal(comboOrder({ status: 'EXECUTING' }))).toBe(false);
  });
});
