/**
 * Contract test: the built SDK (dist/cjs) against the REAL backend controllers, DTO validation
 * (same global ValidationPipe as main.ts) and GlobalExceptionFilter, over real HTTP. Only the
 * services behind the controllers are mocked. Approvals are produced by the real backend mappers
 * and signatures are checked with the backend's own canonicalization, as Privy would.
 */
import 'reflect-metadata';
import { HttpException, HttpStatus, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { getAddress } from 'viem';
import {
  ConflictException,
  ServiceUnavailableException,
} from '@/common/exceptions';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { IntegratorContextService } from '@/modules/integrators';
import {
  TradingAccount,
  TradingAccountOnboardingMapper,
  TradingAccountStatus,
} from '@/modules/trading-accounts';
import { PrivyAppController } from '@/modules/trading-accounts/controllers/privy-app.controller';
import { TradingAccountController } from '@/modules/trading-accounts/controllers/trading-account.controller';
import { TradingAccountOrdersController } from '@/modules/trading-accounts/controllers/trading-account-orders.controller';
import { PrivyAppService } from '@/modules/trading-accounts/services/privy-app.service';
import { TradingAccountOnboardingService } from '@/modules/trading-accounts/services/trading-account-onboarding.service';
import { TradingAccountPortfolioService } from '@/modules/trading-accounts/services/trading-account-portfolio.service';
import { DirectRedeemService } from '@/modules/trading-accounts/services/direct-redeem.service';
import { TradingAccountRedeemableService } from '@/modules/trading-accounts/services/trading-account-redeemable.service';
import { DirectBuyService } from '@/modules/trading-accounts/services/direct-buy.service';
import { DirectSellService } from '@/modules/trading-accounts/services/direct-sell.service';
import { DirectOrderLifecycleService } from '@/modules/trading-accounts/services/direct-order-lifecycle.service';
import { DirectOrderQueryService } from '@/modules/trading-accounts/services/direct-order-query.service';
import { AuthorizationSetupMapper } from '@/modules/trading-accounts/mappers/authorization-setup.mapper';
import { TradingPolicyInputMapper } from '@/modules/trading-accounts/mappers/trading-policy-input.mapper';
import {
  canonicalPrivyPayload,
  privyPayloadDigest,
} from '@/modules/trading-accounts/utils/canonical-privy-payload';
import { CombosController } from '@/modules/combos/controllers/combos.controller';
import { ComboExecutionService } from '@/modules/combos/services/combo-execution.service';
import { ComboLegsService } from '@/modules/combos/services/combo-legs.service';
import { ComboQueryService } from '@/modules/combos/services/combo-query.service';
import { ComboRedemptionService } from '@/modules/combos/services/combo-redemption.service';
import { ComboOrderMapper } from '@/modules/combos/mappers/combo-order.mapper';
import { ComboOrderDirection, ComboOrderSource, ComboOrderStatus } from '@/core';

const SDK_DIR = process.env.SDK_DIR || resolve(__dirname, '..');
const BACKEND_DIR = process.env.BACKEND_DIR || resolve(__dirname, '../../predikt-aggregator');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdkLib = require(`${SDK_DIR}/dist/cjs/index.js`);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdkServer = require(`${SDK_DIR}/dist/cjs/server.js`);

const INTEGRATOR_ID = randomUUID();
const API_KEY = 'sk_predikt_contract';
const PRIVY_APP = 'cmprivyappcontract0000001';
const PRIVY_WALLET = 'sunjel6yyoyj6ymjll2tk5xm';
const OWNER_ID = 'owner-quorum-contract';
const PREDIKT_SIGNER = 'predikt-signer-contract';
const SIGNER_ADDRESS = '0x1212121212121212121212121212121212121212';
const DEPOSIT = '0xcd466971e81fd723dbeef85dd37cb3993ff89b38';
const ACCOUNT_ID = randomUUID();
const MAX = '10000000';
const EXPIRES = '2027-12-15T12:00:00Z';

const owner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const OWNER_KEY = `wallet-auth:${owner.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}`;

const mocks = {
  privyApp: { connect: jest.fn(), get: jest.fn() },
  onboarding: { register: jest.fn(), get: jest.fn(), activate: jest.fn(), reauthorize: jest.fn() },
  portfolio: { get: jest.fn() },
  redeem: { redeem: jest.fn() },
  redeemable: { get: jest.fn() },
  buy: { buy: jest.fn() },
  sell: { sell: jest.fn() },
  lifecycle: { get: jest.fn() },
  queries: { list: jest.fn() },
  comboExec: { buy: jest.fn(), sell: jest.fn() },
  comboLegs: { quote: jest.fn() },
  comboQuery: { listMarkets: jest.fn(), listOrders: jest.fn(), getOrder: jest.fn(), listPositions: jest.fn(), listActivity: jest.fn() },
  comboRedeem: { redeem: jest.fn() },
};

let app: INestApplication;
let baseUrl: string;
const seenApiKeys: string[] = [];

function client(config: Record<string, unknown> = {}) {
  return new sdkLib.PrediktSDK({
    baseUrl,
    apiKey: API_KEY,
    retry: { baseDelayMs: 1, approvalsPendingDelayMs: 1 },
    ...config,
  });
}

async function failure(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  @Module({
    controllers: [PrivyAppController, TradingAccountController, TradingAccountOrdersController, CombosController],
    providers: [
      { provide: IntegratorContextService, useValue: { require: () => INTEGRATOR_ID, getApiKeyId: () => 'api-key-id' } },
      { provide: PrivyAppService, useValue: mocks.privyApp },
      { provide: TradingAccountOnboardingService, useValue: mocks.onboarding },
      { provide: TradingAccountPortfolioService, useValue: mocks.portfolio },
      { provide: DirectRedeemService, useValue: mocks.redeem },
      { provide: TradingAccountRedeemableService, useValue: mocks.redeemable },
      { provide: DirectBuyService, useValue: mocks.buy },
      { provide: DirectSellService, useValue: mocks.sell },
      { provide: DirectOrderLifecycleService, useValue: mocks.lifecycle },
      { provide: DirectOrderQueryService, useValue: mocks.queries },
      { provide: ComboExecutionService, useValue: mocks.comboExec },
      { provide: ComboLegsService, useValue: mocks.comboLegs },
      { provide: ComboQueryService, useValue: mocks.comboQuery },
      { provide: ComboRedemptionService, useValue: mocks.comboRedeem },
      ComboOrderMapper,
    ],
  })
  class ContractModule {}
  app = await NestFactory.create(ContractModule, { logger: false });
  app.use((req: { headers: Record<string, string> }, _res: unknown, next: () => void) => {
    seenApiKeys.push(req.headers['x-api-key']);
    next();
  });
  // Same global setup as src/main.ts.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter({ warn: () => undefined, error: () => undefined } as never));
  await app.listen(0, '127.0.0.1');
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  for (const group of Object.values(mocks)) for (const fn of Object.values(group)) (fn as jest.Mock).mockReset();
});

// ─── Approval built by the backend's real mappers ────────────────────────────

function grant(max: string, expiresAt: string) {
  return {
    id: randomUUID(),
    delegatedSignerId: PREDIKT_SIGNER,
    allowedActions: ['buy', 'sell', 'redeem', 'cancel'],
    maxBuyAmountPerOrder: max,
    expiresAt: new Date(expiresAt),
    tradingAccount: { privyWalletId: PRIVY_WALLET, walletConnection: { privyAppId: PRIVY_APP } },
  } as any;
}

function issue(max: string, expiresAt: string, currentSigners: { signer_id: string; override_policy_ids: string[] }[]) {
  const g = grant(max, expiresAt);
  const policyId = `policy-${g.id.slice(0, 8)}`;
  const policy = new TradingPolicyInputMapper().toPolicy(
    { expiresAt: g.expiresAt.toISOString(), signerAddress: SIGNER_ADDRESS, depositWalletAddress: DEPOSIT } as any,
    g.id,
    OWNER_ID,
  );
  const mapper = new AuthorizationSetupMapper({} as any);
  const document = mapper.prepare(
    g,
    { ownerId: OWNER_ID, policyId } as any,
    {
      ownerId: OWNER_ID,
      policyIds: [],
      authorizationThreshold: 1,
      additionalSigners: currentSigners.map((s) => ({ signerId: s.signer_id, overridePolicyIds: s.override_policy_ids })),
    } as any,
    Date.now(),
  );
  return { approval: mapper.toResponse(g, document), policy, policyId };
}

/** Privy as the integrator sees it: addresses in checksum case, rules with ids. */
function privyFake(currentSigners: unknown[], policyId: string, policy: { rules: Record<string, unknown>[] } & Record<string, unknown>) {
  const checksum = (value: unknown) => (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? getAddress(value) : value);
  const rules = policy.rules.map((rule, index) => ({
    id: `rule-${index}`,
    ...rule,
    conditions: (rule.conditions as Record<string, unknown>[]).map((c) => ({ ...c, value: checksum(c.value) })),
  }));
  const calls: string[] = [];
  const fetchImpl = async (input: string) => {
    calls.push(input);
    if (input === `https://api.privy.io/v1/wallets/${PRIVY_WALLET}`)
      return Response.json({ id: PRIVY_WALLET, address: getAddress(SIGNER_ADDRESS), owner_id: OWNER_ID, additional_signers: currentSigners });
    if (input === `https://api.privy.io/v1/policies/${policyId}`) return Response.json({ id: policyId, ...policy, rules });
    return Response.json({}, { status: 404 });
  };
  return { fetchImpl, calls };
}

type Limits = [max: string, expiresAt: string];
const onboardingMapper = new TradingAccountOnboardingMapper();

/** The response the backend's real onboarding mapper builds for an active and a pending grant. */
function accountResponse(active: Limits | null, pending: Limits | null, approval: unknown = null) {
  const grant = (limits: Limits | null) =>
    limits && {
      id: randomUUID(),
      maxBuyAmountPerOrder: limits[0],
      expiresAt: new Date(limits[1]).toISOString(),
      policyProfile: 'polymarket-privy-1271-broad-batch-v4',
    };
  const account = Object.assign(new TradingAccount(), {
    id: ACCOUNT_ID,
    privyWalletId: PRIVY_WALLET,
    depositWalletAddress: DEPOSIT,
    status: TradingAccountStatus.ACTIVE,
  });
  return onboardingMapper.toResponse(
    account,
    { version: 1, activeAuthorization: grant(active), pendingAuthorization: grant(pending) } as never,
    approval as never,
  );
}

/** What Privy does with the owner's signature: verify it over the canonical payload. */
function privyAccepts(approval: any, signature: string): boolean {
  return verify('sha256', Buffer.from(canonicalPrivyPayload(approval.signaturePayload)), owner.publicKey, Buffer.from(signature, 'base64'));
}

describe('onboarding', () => {
  it('connects the Privy app', async () => {
    mocks.privyApp.connect.mockResolvedValue({ appId: PRIVY_APP, environment: 'production', status: 'active' });
    mocks.privyApp.get.mockResolvedValue({ appId: PRIVY_APP, environment: 'production', status: 'active' });
    const sdk = client();
    expect(await sdk.privyApp.connect({ appId: PRIVY_APP, environment: 'production' })).toEqual({ appId: PRIVY_APP, environment: 'production', status: 'active' });
    expect((await sdk.privyApp.get()).status).toBe('active');
    expect(mocks.privyApp.connect.mock.calls[0][1]).toEqual({ appId: PRIVY_APP, environment: 'production' });
    expect(seenApiKeys.at(-1)).toBe(API_KEY);
  });

  it('register (202 provisioning → approval) → verifyAndSignApproval → activate, accepted by Privy', async () => {
    const { approval, policy, policyId } = issue(MAX, EXPIRES, []);
    let calls = 0;
    mocks.onboarding.register.mockImplementation(async () =>
      ++calls === 1
        ? onboardingMapper.provisioning(PRIVY_WALLET, DEPOSIT)
        : accountResponse(null, [MAX, EXPIRES], approval),
    );
    mocks.onboarding.activate.mockImplementation(async (_ctx: unknown, accountId: string, input: { approvalDigest: string; signatures: string[] }) => {
      if (accountId !== ACCOUNT_ID || input.approvalDigest !== approval.approvalDigest || !privyAccepts(approval, input.signatures[0]))
        throw new ConflictException('PRIVY_SETUP_REJECTED', { userMessage: 'Privy rejected the signature.' });
      return accountResponse([MAX, EXPIRES], null);
    });

    const sdk = client();
    const pending = await sdk.accounts.register({ privyWalletId: PRIVY_WALLET, maxBuyAmountPerOrder: MAX, expiresAt: EXPIRES }, { pollIntervalMs: 10 });
    expect(pending.status).toBe('awaiting_owner_approval');
    expect(pending.activeGrant).toBeNull();
    expect(sdkLib.isReauthorizationPending(pending)).toBe(false);
    expect(mocks.onboarding.register).toHaveBeenCalledTimes(2);
    expect(mocks.onboarding.register.mock.calls[0][1]).toEqual({ privyWalletId: PRIVY_WALLET, maxBuyAmountPerOrder: MAX, expiresAt: EXPIRES });

    const privy = privyFake([], policyId, policy as any);
    const signed = await sdkServer.verifyAndSignApproval(pending, {
      ownerKey: OWNER_KEY,
      privyAppId: PRIVY_APP,
      privyAppSecret: 'secret',
      expected: { privyWalletId: PRIVY_WALLET, maxBuyAmountPerOrder: MAX, expiresAt: EXPIRES },
      fetch: privy.fetchImpl,
    });
    expect(privy.calls).toHaveLength(2);
    // SDK canonicalization == backend canonicalization.
    expect(signed.approvalDigest).toBe(privyPayloadDigest(approval.signaturePayload));

    const active = await sdk.accounts.activate(pending, signed);
    expect(active.status).toBe('active');
    expect(active.activeGrant).toEqual({
      maxBuyAmountPerOrder: MAX,
      expiresAt: new Date(EXPIRES).toISOString(),
      policyProfile: 'polymarket-privy-1271-broad-batch-v4',
      combosEnabled: true,
    });
    expect(mocks.onboarding.activate).toHaveBeenCalledTimes(1);
  });

  it('reauthorize keeps other signers, re-points Predikt, and is accepted', async () => {
    const current = [
      { signer_id: 'casino-ops', override_policy_ids: ['casino-policy'] },
      { signer_id: PREDIKT_SIGNER, override_policy_ids: ['old-v3-policy'] },
    ];
    const { approval, policy, policyId } = issue('20000000', '2028-01-15T12:00:00Z', current);
    const next: Limits = ['20000000', '2028-01-15T12:00:00Z'];
    mocks.onboarding.reauthorize.mockResolvedValue(accountResponse([MAX, EXPIRES], next, approval));
    mocks.onboarding.get.mockResolvedValue(accountResponse([MAX, EXPIRES], next));
    mocks.onboarding.activate.mockImplementation(async (_c: unknown, _id: string, input: { signatures: string[] }) =>
      privyAccepts(approval, input.signatures[0]) ? accountResponse(next, null) : Promise.reject(new Error('rejected')),
    );
    const sdk = client();
    const pending = await sdk.accounts.reauthorize(ACCOUNT_ID, { maxBuyAmountPerOrder: '20000000', expiresAt: '2028-01-15T12:00:00Z' });
    // While pending, the account keeps trading under the old grant (backend `activeGrant`).
    const during = await sdk.accounts.get(ACCOUNT_ID);
    expect(during.status).toBe('awaiting_owner_approval');
    expect(sdkLib.isReauthorizationPending(during)).toBe(true);
    expect(during.activeGrant).toMatchObject({ maxBuyAmountPerOrder: MAX, expiresAt: new Date(EXPIRES).toISOString(), combosEnabled: true });
    expect(during.maxBuyAmountPerOrder).toBe('20000000');
    expect(mocks.onboarding.reauthorize.mock.calls[0][2]).toEqual({ maxBuyAmountPerOrder: '20000000', expiresAt: '2028-01-15T12:00:00Z' });
    const signed = await sdkServer.verifyAndSignApproval(pending, {
      ownerKey: OWNER_KEY,
      privyAppId: PRIVY_APP,
      privyAppSecret: 'secret',
      expected: { privyWalletId: PRIVY_WALLET, maxBuyAmountPerOrder: '20000000', expiresAt: '2028-01-15T12:00:00Z', ownerId: OWNER_ID },
      fetch: privyFake(current, policyId, policy as any).fetchImpl,
    });
    const activated = await sdk.accounts.activate(ACCOUNT_ID, signed);
    expect([activated.status, activated.activeGrant?.maxBuyAmountPerOrder]).toEqual(['active', '20000000']);
  });

  it('refuses a broadened approval from a compromised Predikt', async () => {
    const { approval, policy, policyId } = issue(MAX, EXPIRES, []);
    approval.signaturePayload.body.additional_signers.push({ signer_id: 'attacker', override_policy_ids: [] });
    approval.approvalDigest = privyPayloadDigest(approval.signaturePayload);
    const error = await failure(
      sdkServer.verifyAndSignApproval(accountResponse(null, [MAX, EXPIRES], approval), {
        ownerKey: OWNER_KEY,
        privyAppId: PRIVY_APP,
        privyAppSecret: 'secret',
        expected: { privyWalletId: PRIVY_WALLET, maxBuyAmountPerOrder: MAX, expiresAt: EXPIRES },
        fetch: privyFake([], policyId, policy as any).fetchImpl,
      }),
    );
    expect(error.code).toBe('SIGNERS_CHANGED');
  });

  it('reads status, portfolio, redeemable; maps onboarding errors', async () => {
    mocks.onboarding.get.mockResolvedValue(accountResponse([MAX, EXPIRES], null));
    mocks.portfolio.get.mockResolvedValue({ accountId: ACCOUNT_ID, status: 'active', tradingAddress: DEPOSIT, balances: { pusd: '13070000', usdce: '0' }, positions: null, positionsError: 'POSITIONS_UNAVAILABLE', asOf: new Date().toISOString() });
    mocks.redeemable.get.mockResolvedValue({ accountId: ACCOUNT_ID, markets: [], asOf: new Date().toISOString() });
    const sdk = client();
    expect((await sdk.accounts.get(ACCOUNT_ID)).status).toBe('active');
    expect((await sdk.accounts.portfolio(ACCOUNT_ID)).balances.pusd).toBe('13070000');
    expect((await sdk.accounts.redeemable(ACCOUNT_ID)).markets).toEqual([]);

    mocks.onboarding.register.mockRejectedValue(new ConflictException('TRADING_AUTHORIZATION_EXISTS', { userMessage: 'Different limits; use reauthorize.' }));
    const error = await failure(sdk.accounts.register({ privyWalletId: PRIVY_WALLET, maxBuyAmountPerOrder: '1', expiresAt: EXPIRES }));
    expect(error).toBeInstanceOf(sdkLib.PrediktConflictError);
    expect(error.code).toBe('TRADING_AUTHORIZATION_EXISTS');
  });

  it('backend validation rejects bad input with a typed 400', async () => {
    const sdk = client();
    const badWallet = await failure(sdk.accounts.register({ privyWalletId: DEPOSIT, maxBuyAmountPerOrder: MAX, expiresAt: EXPIRES }));
    expect(badWallet).toBeInstanceOf(sdkLib.PrediktValidationError);
    expect(badWallet.message).toContain('privyWalletId');
    const badExpiry = await failure(sdk.accounts.reauthorize(ACCOUNT_ID, { maxBuyAmountPerOrder: MAX, expiresAt: '2027-12-15' }));
    expect(badExpiry.status).toBe(400);
    const badId = await failure(sdk.accounts.get('not-a-uuid'));
    expect(badId.status).toBe(400);
  });
});

// ─── Direct trading ──────────────────────────────────────────────────────────

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderId: randomUUID(), accountId: ACCOUNT_ID, side: 'buy', source: 'integrator', status: 'filled', tokenId: '5511', conditionId: null,
    redeemedPositions: null, amount: '2000000', principal: '1940000', slippagePercent: '5', bestPriceAtOrder: '0.17', limitPrice: '0.17',
    clobOrderId: '0x1', spentAmount: '1940000', receivedAmount: null, filledShares: '11411765', transactionHashes: ['0x2'], reasonCode: null, fees: null,
    ...overrides,
  };
}

describe('direct trading', () => {
  it('buy / sell / redeem pass DTO validation unchanged', async () => {
    mocks.buy.buy.mockResolvedValue(order());
    mocks.sell.sell.mockResolvedValue(order({ side: 'sell' }));
    mocks.redeem.redeem.mockResolvedValue(order({ side: 'redeem', status: 'redeemed' }));
    const sdk = client();
    await sdk.trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', slippagePercent: '2.5', idempotencyKey: 'casino-order-0001' });
    await sdk.trading.sell(ACCOUNT_ID, { tokenId: '5511', shares: 'all', idempotencyKey: 'casino-order-0002' });
    const redeemed = await sdk.trading.redeem(ACCOUNT_ID, { conditionId: `0x${'ab'.repeat(32)}`, idempotencyKey: 'casino-redeem-0001' });
    expect(redeemed.status).toBe('redeemed');
    expect(mocks.buy.buy.mock.calls[0].slice(1)).toEqual([ACCOUNT_ID, { tokenId: '5511', amount: '2000000', slippagePercent: '2.5', idempotencyKey: 'casino-order-0001' }]);
    expect(mocks.sell.sell.mock.calls[0][2]).toEqual({ tokenId: '5511', shares: 'all', idempotencyKey: 'casino-order-0002' });
    expect(mocks.redeem.redeem.mock.calls[0][2]).toEqual({ conditionId: `0x${'ab'.repeat(32)}`, idempotencyKey: 'casino-redeem-0001' });
  });

  it('invalid input is a typed 400 (no retry)', async () => {
    const sdk = client();
    const shortKey = await failure(sdk.trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', idempotencyKey: 'short' }));
    expect(shortKey).toBeInstanceOf(sdkLib.PrediktValidationError);
    const slippage = await failure(sdk.trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', slippagePercent: '51', idempotencyKey: 'casino-order-0003' }));
    expect(slippage.status).toBe(400);
    expect(mocks.buy.buy).not.toHaveBeenCalled();
  });

  it('extra caller fields are dropped by the SDK, so forbidNonWhitelisted does not reject them', async () => {
    mocks.buy.buy.mockResolvedValue(order());
    await client().trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', idempotencyKey: 'casino-order-0004', userId: 'u1' } as never);
    expect(mocks.buy.buy).toHaveBeenCalledTimes(1);
  });

  it('retries TRADING_APPROVALS_PENDING and retryable 503 with the same key; surfaces details', async () => {
    const recorded = order();
    mocks.buy.buy
      .mockRejectedValueOnce(new ConflictException('TRADING_APPROVALS_PENDING', { userMessage: 'Approvals pending; retry.' }))
      .mockRejectedValueOnce(new ServiceUnavailableException('POLYMARKET_RATE_LIMITED', { userMessage: 'Busy' }).withDetails({ retryable: true }))
      .mockResolvedValueOnce(recorded);
    const result = await client().trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', idempotencyKey: 'casino-order-0005' });
    expect(result.orderId).toBe(recorded.orderId);
    expect(mocks.buy.buy).toHaveBeenCalledTimes(3);
    expect(new Set(mocks.buy.buy.mock.calls.map((c: unknown[]) => JSON.stringify(c[2]))).size).toBe(1);

    mocks.buy.buy.mockRejectedValue(new ServiceUnavailableException('PRIVY_SIGNING_UNAVAILABLE', { userMessage: 'Privy down' }).withDetails({ orderId: recorded.orderId, retryable: false }));
    const error = await failure(client().trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', idempotencyKey: 'casino-order-0006' }));
    expect(error).toBeInstanceOf(sdkLib.PrediktServiceUnavailableError);
    expect([error.code, error.orderId, error.retryable]).toEqual(['PRIVY_SIGNING_UNAVAILABLE', recorded.orderId, false]);

    // Recorded order + retryable (backend: "No funds moved; retry with a new idempotencyKey"): surfaced, not repeated.
    mocks.buy.buy.mockReset();
    mocks.buy.buy.mockRejectedValue(new ServiceUnavailableException('PRIVY_SIGNING_UNAVAILABLE', { userMessage: 'Retry with a new idempotencyKey.' }).withDetails({ orderId: recorded.orderId, retryable: true }));
    const recordedError = await failure(client().trading.buy(ACCOUNT_ID, { tokenId: '5511', amount: '2000000', idempotencyKey: 'casino-order-0007' }));
    expect([recordedError.orderId, recordedError.retryable]).toEqual([recorded.orderId, true]);
    expect(mocks.buy.buy).toHaveBeenCalledTimes(1);
  });

  it('getOrder, change feed query transform and waitForOrder', async () => {
    const id = randomUUID();
    mocks.lifecycle.get
      .mockResolvedValueOnce(order({ orderId: id, status: 'submitted', spentAmount: null }))
      .mockResolvedValueOnce(order({ orderId: id, status: 'filled', spentAmount: '1940000' }));
    mocks.queries.list.mockResolvedValue({ orders: [order({ side: 'redeem', source: 'polymarket_auto', status: 'redeemed', receivedAmount: '2836735' })], nextCursor: 'MTc5MjA', hasMore: false });
    const sdk = client();
    const settled = await sdk.trading.waitForOrder(ACCOUNT_ID, id, { intervalMs: 5 });
    expect(settled.spentAmount).toBe('1940000');
    expect(mocks.lifecycle.get.mock.calls[0]).toEqual([INTEGRATOR_ID, ACCOUNT_ID, id]);

    const pages = [];
    for await (const page of sdk.trading.iterateOrderChanges(ACCOUNT_ID, { limit: 50, side: 'redeem', source: 'polymarket_auto' })) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(mocks.queries.list.mock.calls[0][2]).toEqual({ limit: 50, side: 'redeem', source: 'polymarket_auto' });

    const badCursor = await failure(sdk.trading.listOrderChanges(ACCOUNT_ID, { cursor: 'bad cursor!' }));
    expect(badCursor.status).toBe(400);
  });
});

// ─── Combos ──────────────────────────────────────────────────────────────────

const LEGS = [
  { marketId: '682708', outcome: 0 },
  { marketId: '1090496', outcome: 1 },
];
const resolvedLegs = LEGS.map((leg, i) => ({ ...leg, positionId: `${i + 1}042`, title: `Market ${i}`, outcomeLabel: i ? 'No' : 'Yes', price: '0.5' }));
const COMBO_CONDITION = '0x03d3cd957beec0a5317055175d094724d4'.padEnd(66, '0'); // bytes32 (RFQ form)

/** Entity as the execution service persists it, built with the real mapper. */
function comboEntity(base: Record<string, unknown>, fill: Record<string, unknown>) {
  return {
    id: randomUUID(), source: ComboOrderSource.API, status: ComboOrderStatus.FILLED, comboConditionId: COMBO_CONDITION.slice(0, 64),
    comboPositionId: '1731', rfqId: 'rfq-1', quotedPriceE6: '383900', effectivePriceE6: '395725', makerAmountE6: '5054026',
    totalRequiredE6: '2000000', netReceiveE6: '5054026', txHash: '0xc36b', errorCode: null, errorMessage: null,
    createdAt: new Date(), filledAt: new Date(), ...base, ...fill,
  };
}

describe('combos', () => {
  it('markets (query transform) and quote (legs DTO)', async () => {
    mocks.comboQuery.listMarkets.mockResolvedValue({ markets: [], nextCursor: null });
    mocks.comboLegs.quote.mockResolvedValue({ indicativePrice: '0.366818', estimatedShares: '2726143', potentialPayout: '2726143', legs: resolvedLegs });
    const sdk = client();
    await sdk.combos.listMarkets({ limit: 2, cursor: 'abc' });
    expect(mocks.comboQuery.listMarkets.mock.calls[0][0]).toEqual({ limit: 2, cursor: 'abc' });
    const quote = await sdk.combos.quote({ legs: LEGS, amount: '1000000' });
    expect(quote.legs[1].outcomeLabel).toBe('No');
    expect(mocks.comboLegs.quote.mock.calls[0]).toEqual([LEGS, '1000000']);
  });

  it('buy with a checksummed wallet: real mapper output passes the SDK reuse check', async () => {
    const mapper = new ComboOrderMapper();
    mocks.comboExec.buy.mockImplementation(async (input: any) => comboEntity(mapper.toBuyEntity(input, resolvedLegs as any) as any, {}));
    const order = await client().combos.buy({ wallet: getAddress(DEPOSIT), legs: LEGS, amount: '2000000', maxPrice: '0.41', clientOrderId: 'casino-combo-0001' });
    expect(order).toMatchObject({ direction: 'BUY', status: 'FILLED', wallet: DEPOSIT, requestedAmount: '2000000', limitPrice: '0.41', shares: '5054026', amount: '2000000' });
    expect(mocks.comboExec.buy.mock.calls[0][0]).toMatchObject({ integratorId: INTEGRATOR_ID, walletAddress: getAddress(DEPOSIT), legs: LEGS, amount: '2000000', maxPrice: '0.41', clientOrderId: 'casino-combo-0001' });
  });

  it('a reused clientOrderId for a different ticket is a 409 from the real ComboExecutionService', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fx = require(`${BACKEND_DIR}/test/combos/fixture/combo.fixtures`);
    const rfqClient = {
      createRfq: jest.fn().mockResolvedValue(fx.buyQuoteResponse()),
      acceptQuote: jest.fn().mockResolvedValue({ rfq_id: 'rfq-1', status: 'EXECUTING', taker_order_hash: '0xhash' }),
      getRfq: jest.fn().mockResolvedValue({ rfq_id: 'rfq-1', status: 'FILLED', tx_hash: '0xtx' }),
    };
    const real = new ComboExecutionService(
      new fx.InMemoryComboOrderRepository(),
      new ComboOrderMapper(),
      { resolve: jest.fn().mockResolvedValue(fx.RESOLVED_LEGS) } as never,
      rfqClient as never,
      { consume: jest.fn() } as never,
      {
        resolveWallet: jest.fn().mockResolvedValue(fx.WALLET_IDENTITY),
        getClobCredentials: jest.fn().mockResolvedValue(fx.CREDENTIALS),
        signTypedData: jest.fn().mockResolvedValue(fx.INNER_SIGNATURE),
      } as never,
      { get: () => ({ executionWaitMs: 100, statusPollIntervalMs: 1 }) } as never,
    );
    mocks.comboExec.buy.mockImplementation((input: never) => real.buy(input));
    const ticket = { wallet: fx.DEPOSIT_WALLET, legs: [{ marketId: '1', outcome: 0 }, { marketId: '2', outcome: 1 }], amount: '1000000', maxPrice: '0.52', clientOrderId: 'contract-ticket' };
    const sdk = client();

    const first = await sdk.combos.buy(ticket);
    expect(first.status).toBe('FILLED');
    expect((await sdk.combos.buy({ ...ticket, legs: [...ticket.legs].reverse() })).id).toBe(first.id);

    const error = await failure(sdk.combos.buy({ ...ticket, amount: '2000000' }));
    expect(error).toBeInstanceOf(sdkLib.PrediktConflictError);
    expect([error.code, error.orderId, error.details.mismatch]).toEqual(['COMBO_CLIENT_ORDER_ID_REUSED', first.id, ['amount']]);
    expect(error.details.raisedBy).toBeUndefined(); // the API's 409, not the SDK's fallback check
    expect(rfqClient.createRfq).toHaveBeenCalledTimes(1);
  });

  it('sell with the bytes32 condition id and redeem: mapper normalization passes the check', async () => {
    const mapper = new ComboOrderMapper();
    mocks.comboExec.sell.mockImplementation(async (input: any) => comboEntity(mapper.toSellEntity(input, resolvedLegs as any, '1731') as any, { netReceiveE6: '1900000' }));
    mocks.comboRedeem.redeem.mockImplementation(async (input: any) =>
      comboEntity(
        { integratorId: INTEGRATOR_ID, clientOrderId: input.clientOrderId, walletAddress: input.walletAddress.toLowerCase(), direction: ComboOrderDirection.REDEEM, legs: resolvedLegs, comboConditionId: input.comboConditionId.slice(0, 64), requestedSizeE6: '5054026', limitPriceE6: '0' },
        { netReceiveE6: '5054026', makerAmountE6: '5054026' },
      ),
    );
    const sdk = client();
    const sold = await sdk.combos.sell({ wallet: DEPOSIT, comboConditionId: COMBO_CONDITION, shares: '5054026', minPrice: '0.30', clientOrderId: 'casino-combo-sell-0001' });
    expect(sold).toMatchObject({ direction: 'SELL', requestedShares: '5054026', limitPrice: '0.3', amount: '1900000' });
    expect(mocks.comboExec.sell.mock.calls[0][0]).toMatchObject({ comboConditionId: COMBO_CONDITION, shares: '5054026', minPrice: '0.30', allowPartialFill: false });
    const redeemed = await sdk.combos.redeem({ wallet: DEPOSIT, comboConditionId: COMBO_CONDITION, clientOrderId: 'casino-combo-redeem-0001' });
    expect(redeemed).toMatchObject({ direction: 'REDEEM', limitPrice: null, amount: '5054026' });
  });

  it('validation, 429 rate limit and COMBO errors are typed', async () => {
    const sdk = client();
    const oneLeg = await failure(sdk.combos.buy({ wallet: DEPOSIT, legs: [LEGS[0]], amount: '2000000', maxPrice: '0.41', clientOrderId: 'k' }));
    expect(oneLeg.status).toBe(400);
    const price = await failure(sdk.combos.buy({ wallet: DEPOSIT, legs: LEGS, amount: '2000000', maxPrice: '1.5', clientOrderId: 'k' }));
    expect(price.status).toBe(400);

    mocks.comboExec.buy.mockRejectedValue(new HttpException('Combo RFQ rate limit exceeded for this wallet (Polymarket allows 15 per minute)', HttpStatus.TOO_MANY_REQUESTS));
    const limited = await failure(sdk.combos.buy({ wallet: DEPOSIT, legs: LEGS, amount: '2000000', maxPrice: '0.41', clientOrderId: 'k' }));
    expect(limited).toBeInstanceOf(sdkLib.PrediktRateLimitError);
    expect(mocks.comboExec.buy).toHaveBeenCalledTimes(1);

    mocks.comboRedeem.redeem.mockRejectedValue(new ConflictException('COMBO_NOT_REDEEMABLE', { userMessage: 'Not redeemable yet.' }));
    const notRedeemable = await failure(sdk.combos.redeem({ wallet: DEPOSIT, comboConditionId: COMBO_CONDITION, clientOrderId: 'r' }));
    expect([notRedeemable.status, notRedeemable.code]).toEqual([409, 'COMBO_NOT_REDEEMABLE']);
  });

  it('orders, positions and activity queries pass validation', async () => {
    const mapper = new ComboOrderMapper();
    const entity = comboEntity(mapper.toBuyEntity({ integratorId: INTEGRATOR_ID, sdkApiKeyId: null, walletAddress: DEPOSIT, legs: LEGS as any, amount: '2000000', maxPrice: '0.41', clientOrderId: 'x' }, resolvedLegs as any) as any, { status: ComboOrderStatus.EXECUTING });
    mocks.comboQuery.getOrder
      .mockResolvedValueOnce(mapper.toResponse(entity as any))
      .mockResolvedValueOnce(mapper.toResponse({ ...entity, status: ComboOrderStatus.FILLED } as any));
    mocks.comboQuery.listOrders.mockResolvedValue({ data: [], pagination: { currentPage: 1, itemsPerPage: 20, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } });
    mocks.comboQuery.listPositions.mockResolvedValue({ data: [{ combo_condition_id: '0x03d3', combo_position_id: '1731', current_size: 5.054026, redeemable: false }], pagination: { has_more: false } });
    mocks.comboQuery.listActivity.mockResolvedValue({ data: [] });
    const sdk = client();

    const done = await sdk.combos.waitForOrder(entity.id, { intervalMs: 5 });
    expect(done.status).toBe('FILLED');
    expect(typeof done.createdAt).toBe('string');

    await sdk.combos.listOrders({ wallet: getAddress(DEPOSIT), status: 'FILLED', limit: 20, offset: 0 });
    expect(mocks.comboQuery.listOrders.mock.calls[0]).toEqual([INTEGRATOR_ID, { wallet: getAddress(DEPOSIT), status: 'FILLED', limit: 20, offset: 0 }]);
    const positions = await sdk.combos.positions({ wallet: DEPOSIT, status: 'REDEEMABLE', condition: '0x03d3', limit: 50 });
    expect(positions.data[0].current_size).toBe(5.054026);
    expect(mocks.comboQuery.listPositions.mock.calls[0]).toEqual([INTEGRATOR_ID, DEPOSIT, { status: 'REDEEMABLE', condition: '0x03d3', limit: 50, cursor: undefined }]);
    await sdk.combos.activity({ wallet: DEPOSIT, cursor: 'c' });
    expect(mocks.comboQuery.listActivity.mock.calls[0]).toEqual([INTEGRATOR_ID, DEPOSIT, { condition: undefined, limit: undefined, cursor: 'c' }]);

    const badId = await failure(sdk.combos.getOrder('not-a-uuid'));
    expect(badId.status).toBe(400);
  });
});
