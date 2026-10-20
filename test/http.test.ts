import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PrediktApiError,
  PrediktConflictError,
  PrediktRateLimitError,
  PrediktServiceUnavailableError,
  PrediktValidationError,
} from '../src/index.js';
import { directOrder } from './fixtures.js';
import { ACCOUNT_ID, API_KEY, apiError, BASE_URL, json, mockFetch, sdk } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BUY = { tokenId: '5511', amount: '2000000', idempotencyKey: 'casino-order-0001' };

describe('errors', () => {
  it('maps the API error body, including details', async () => {
    mockFetch(() => apiError(409, 'IDEMPOTENCY_KEY_REUSED', { orderId: 'o-1' }));
    const error = await sdk().trading.buy(ACCOUNT_ID, BUY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrediktConflictError);
    expect(error).toMatchObject({
      status: 409,
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'IDEMPOTENCY_KEY_REUSED message',
      details: { orderId: 'o-1' },
      orderId: 'o-1',
      retryable: undefined,
    });
  });

  it('maps 503 provider outages with retryable', async () => {
    mockFetch(() => apiError(503, 'PRIVY_SIGNING_UNAVAILABLE', { orderId: 'o-2', retryable: false }));
    const error = (await sdk().trading.buy(ACCOUNT_ID, BUY).catch((e: unknown) => e)) as PrediktApiError;
    expect(error).toBeInstanceOf(PrediktServiceUnavailableError);
    expect(error.retryable).toBe(false);
    expect(error.orderId).toBe('o-2');
  });

  it('joins validation message arrays and keeps Retry-After', async () => {
    mockFetch(() => json(400, { statusCode: 400, message: ['a must be a string', 'b is required'] }));
    const validation = await sdk().combos.quote({ legs: [], amount: '1' }).catch((e: unknown) => e);
    expect(validation).toBeInstanceOf(PrediktValidationError);
    expect((validation as Error).message).toBe('a must be a string, b is required');

    mockFetch(() => json(429, { statusCode: 429, code: 'HTTP', message: 'slow down' }, { 'Retry-After': '42' }));
    const limited = await sdk().combos.quote({ legs: [], amount: '1' }).catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(PrediktRateLimitError);
    expect((limited as PrediktRateLimitError).retryAfter).toBe(42);
  });
});

describe('requests', () => {
  it('sends the API key, JSON body and keeps a base URL path prefix', async () => {
    const { calls } = mockFetch(() => json(200, directOrder()));
    await sdk({ baseUrl: `${BASE_URL}/api/` }).trading.buy(ACCOUNT_ID, BUY);
    expect(calls[0].url.toString()).toBe(`${BASE_URL}/api/direct/trading-accounts/${ACCOUNT_ID}/orders/buy`);
    expect(calls[0].headers['x-api-key']).toBe(API_KEY);
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('aborts after timeoutMs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
      ),
    );
    const error = await sdk({ timeoutMs: 20, retry: false }).trading.getOrder(ACCOUNT_ID, 'o-1').catch((e: unknown) => e);
    expect((error as Error).name).toBe('TimeoutError');
  });
});

describe('retries (idempotent calls only, same request each time)', () => {
  it('retries network errors with the same idempotency key', async () => {
    let attempts = 0;
    const { calls } = mockFetch(() => {
      attempts++;
      if (attempts < 3) return Promise.reject(new TypeError('fetch failed'));
      return json(200, directOrder());
    });
    const order = await sdk().trading.buy(ACCOUNT_ID, BUY);
    expect(order.status).toBe('filled');
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => JSON.stringify(c.body))).size).toBe(1);
  });

  it('gives up after maxRetries and rethrows the network error', async () => {
    const { calls } = mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(sdk().trading.buy(ACCOUNT_ID, BUY)).rejects.toThrow('fetch failed');
    expect(calls).toHaveLength(3);
  });

  it('retries 5xx only when details.retryable is true', async () => {
    let attempts = 0;
    const retryable = mockFetch(() =>
      ++attempts === 1 ? apiError(503, 'POLYMARKET_RATE_LIMITED', { retryable: true }) : json(200, directOrder()),
    );
    await sdk().trading.buy(ACCOUNT_ID, BUY);
    expect(retryable.calls).toHaveLength(2);

    const notRetryable = mockFetch(() => apiError(503, 'PRIVY_SIGNING_UNAVAILABLE', { retryable: false }));
    await expect(sdk().trading.buy(ACCOUNT_ID, BUY)).rejects.toBeInstanceOf(PrediktServiceUnavailableError);
    expect(notRetryable.calls).toHaveLength(1);

    // The order was recorded and Predikt asks for a new key: repeating the same key is pointless.
    const recorded = mockFetch(() => apiError(503, 'PRIVY_SIGNING_UNAVAILABLE', { orderId: 'o-3', retryable: true }));
    await expect(sdk().trading.buy(ACCOUNT_ID, BUY)).rejects.toMatchObject({ orderId: 'o-3', retryable: true });
    expect(recorded.calls).toHaveLength(1);

    const internal = mockFetch(() => apiError(500, 'INTERNAL_ERROR'));
    await expect(sdk().trading.buy(ACCOUNT_ID, BUY)).rejects.toBeInstanceOf(PrediktApiError);
    expect(internal.calls).toHaveLength(1);
  });

  it('repeats 409 TRADING_APPROVALS_PENDING after a delay, then gives up', async () => {
    let attempts = 0;
    const { calls } = mockFetch(() => (++attempts <= 2 ? apiError(409, 'TRADING_APPROVALS_PENDING') : json(200, directOrder())));
    await sdk().trading.buy(ACCOUNT_ID, BUY);
    expect(calls).toHaveLength(3);

    const always = mockFetch(() => apiError(409, 'TRADING_APPROVALS_PENDING'));
    await expect(sdk().trading.buy(ACCOUNT_ID, BUY)).rejects.toMatchObject({ code: 'TRADING_APPROVALS_PENDING' });
    expect(always.calls).toHaveLength(4);
  });

  it('never retries 4xx business errors or 429', async () => {
    for (const response of [
      () => apiError(400, 'INSUFFICIENT_BALANCE'),
      () => apiError(403, 'TRADING_AUTHORIZATION_EXPIRED'),
      () => apiError(409, 'IDEMPOTENCY_KEY_REUSED'),
      () => json(429, { statusCode: 429, code: 'HTTP', message: 'limit' }),
    ]) {
      const { calls } = mockFetch(response);
      await expect(sdk().trading.buy(ACCOUNT_ID, BUY)).rejects.toBeInstanceOf(PrediktApiError);
      expect(calls).toHaveLength(1);
    }
  });

  it('can be disabled', async () => {
    const { calls } = mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(sdk({ retry: false }).trading.buy(ACCOUNT_ID, BUY)).rejects.toThrow('fetch failed');
    expect(calls).toHaveLength(1);
  });

  it('does not retry the older, non-idempotent endpoints', async () => {
    const { calls } = mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(sdk().buy.createOrder({} as never)).rejects.toThrow('fetch failed');
    expect(calls).toHaveLength(1);
  });

  it('keeps native fetch errors (not wrapped) as before', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    const error = await sdk({ retry: false }).markets.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(PrediktConflictError);
  });
});
