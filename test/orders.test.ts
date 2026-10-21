import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch, sdk } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('orders', () => {
  it('lists orders as the API envelope { items, total } with offset pagination', async () => {
    const { calls } = mockFetch(() => json(200, { items: [{ id: 'b1', status: 'SETTLED' }], total: 47 }));

    const { items, total } = await sdk().orders.listBuyOrders({ limit: 20, offset: 40 });

    expect(items.map((order) => order.id)).toEqual(['b1']);
    expect(total).toBe(47);
    expect(calls[0].url.pathname).toBe('/orders/buy');
    expect(calls[0].url.searchParams.get('limit')).toBe('20');
    expect(calls[0].url.searchParams.get('offset')).toBe('40');
  });

  it('uses the same envelope for sell and redeem lists', async () => {
    mockFetch(() => json(200, { items: [], total: 0 }));

    const sells = await sdk().orders.listSellOrders();
    const redeems = await sdk().orders.listRedeemOrders();

    expect(sells.total).toBe(0);
    expect(redeems.items).toEqual([]);
  });
});
