import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReauthorizationPending, TradingAccount } from '../src/index.js';
import { approvalAccount, EXPIRES_AT, MAX_BUY, PRIVY_WALLET_ID } from './fixtures.js';
import { ACCOUNT_ID, apiError, BASE_URL, json, mockFetch, sdk, WALLET } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const REGISTER = { privyWalletId: PRIVY_WALLET_ID, maxBuyAmountPerOrder: MAX_BUY, expiresAt: EXPIRES_AT };
const provisioning: TradingAccount = {
  accountId: null,
  status: 'provisioning',
  privyWalletId: PRIVY_WALLET_ID,
  depositWalletAddress: null,
  maxBuyAmountPerOrder: null,
  expiresAt: null,
  activeGrant: null,
  approval: null,
};

describe('privyApp', () => {
  it('connects and reads the Privy app', async () => {
    const app = { appId: 'app', environment: 'production', status: 'active' };
    const { calls } = mockFetch(() => json(200, app));
    const client = sdk();
    expect(await client.privyApp.connect({ appId: 'app', environment: 'production' })).toEqual(app);
    expect(await client.privyApp.get()).toEqual(app);
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ['POST', '/direct/privy-app', { appId: 'app', environment: 'production' }],
      ['GET', '/direct/privy-app', undefined],
    ]);
  });
});

describe('accounts.register', () => {
  it('repeats the same request while provisioning (202) and returns the approval', async () => {
    let attempts = 0;
    const { calls } = mockFetch(() => (++attempts < 3 ? json(202, provisioning) : json(200, approvalAccount())));
    const account = await sdk().accounts.register(REGISTER, { pollIntervalMs: 1 });
    expect(account.status).toBe('awaiting_owner_approval');
    expect(account.approval?.approvalDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect([call.method, call.url.toString(), call.body]).toEqual(['POST', `${BASE_URL}/direct/trading-accounts`, REGISTER]);
    }
  });

  it('returns provisioning when asked not to wait, or after the timeout', async () => {
    const { calls } = mockFetch(() => json(202, provisioning));
    expect((await sdk().accounts.register(REGISTER, { waitForProvisioning: false })).status).toBe('provisioning');
    expect(calls).toHaveLength(1);
    expect((await sdk().accounts.register(REGISTER, { pollIntervalMs: 5, timeoutMs: 30 })).status).toBe('provisioning');
    expect(calls.length).toBeGreaterThan(2);
  });

  it('can be aborted while waiting', async () => {
    mockFetch(() => json(202, provisioning));
    const controller = new AbortController();
    const pending = sdk().accounts.register(REGISTER, { pollIntervalMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('stop')), 10);
    await expect(pending).rejects.toThrow('stop');
  });

  it('passes depositWalletAddress through and surfaces onboarding errors', async () => {
    const { calls } = mockFetch(() => apiError(409, 'TRADING_AUTHORIZATION_EXISTS'));
    await expect(sdk().accounts.register({ ...REGISTER, depositWalletAddress: WALLET })).rejects.toMatchObject({
      status: 409,
      code: 'TRADING_AUTHORIZATION_EXISTS',
    });
    expect(calls[0].body).toEqual({ ...REGISTER, depositWalletAddress: WALLET });
  });
});

describe('accounts', () => {
  it('calls get, activate, reauthorize, portfolio and redeemable with an id or an account object', async () => {
    const { calls } = mockFetch(() => json(200, {}));
    const account = approvalAccount();
    const client = sdk();
    await client.accounts.get(account);
    await client.accounts.activate(ACCOUNT_ID, { approvalDigest: 'd'.repeat(64), signatures: ['sig'] });
    await client.accounts.reauthorize(account, { maxBuyAmountPerOrder: '20000000', expiresAt: '2027-01-15T12:00:00Z' });
    await client.accounts.portfolio(account);
    await client.accounts.redeemable(ACCOUNT_ID);
    const base = `/direct/trading-accounts/${ACCOUNT_ID}`;
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ['GET', base, undefined],
      ['POST', `${base}/activate`, { approvalDigest: 'd'.repeat(64), signatures: ['sig'] }],
      ['POST', `${base}/reauthorize`, { maxBuyAmountPerOrder: '20000000', expiresAt: '2027-01-15T12:00:00Z' }],
      ['GET', `${base}/portfolio`, undefined],
      ['GET', `${base}/redeemable`, undefined],
    ]);
  });

  it('sends only the fields the API accepts (it rejects unknown fields)', async () => {
    const { calls } = mockFetch(() => json(200, {}));
    const extra = { maxBuyAmountPerOrder: '1', expiresAt: EXPIRES_AT, note: 'internal' } as never;
    await sdk().accounts.reauthorize(ACCOUNT_ID, extra);
    await sdk().accounts.activate(ACCOUNT_ID, { approvalDigest: 'a', signatures: ['s'], accountId: 'x' } as never);
    expect(calls[0].body).toEqual({ maxBuyAmountPerOrder: '1', expiresAt: EXPIRES_AT });
    expect(calls[1].body).toEqual({ approvalDigest: 'a', signatures: ['s'] });
  });

  it('tells a pending re-authorization (still trading) from a first approval', () => {
    const first = approvalAccount();
    const reauth = {
      ...first,
      activeGrant: { maxBuyAmountPerOrder: '5000000', expiresAt: EXPIRES_AT, policyProfile: null, combosEnabled: null },
    };
    expect(isReauthorizationPending(first)).toBe(false);
    expect(isReauthorizationPending(reauth)).toBe(true);
    expect(isReauthorizationPending({ ...reauth, status: 'active', approval: null })).toBe(false);
    // Responses from API versions without `activeGrant`.
    expect(isReauthorizationPending({ ...first, activeGrant: undefined } as never)).toBe(false);
  });

  it('refuses an account that is still provisioning', async () => {
    mockFetch(() => json(200, {}));
    await expect(sdk().accounts.get(provisioning)).rejects.toThrow(/still provisioning/);
  });
});
