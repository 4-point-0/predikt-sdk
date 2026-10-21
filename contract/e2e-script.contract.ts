/**
 * Runs the SDK's scripts/e2e-checklist.mjs as a real child process against the real backend
 * controllers (stateful mock services) and a fake Privy API, with trading enabled.
 */
import 'reflect-metadata';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getAddress } from 'viem';
import { AuthException, ConflictException } from '@/common/exceptions';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { IntegratorContextService } from '@/modules/integrators';
import {
  TradingAccount,
  TradingAccountOnboardingMapper,
  TradingAccountStatus,
} from '@/modules/trading-accounts';
import { assertSameComboRequest } from '@/modules/combos/helpers/combo-idempotency.helpers';
import { toE6 } from '@/modules/combos/helpers/combo-pricing.helpers';
import { PrivyAppController } from '@/modules/trading-accounts/controllers/privy-app.controller';
import { TradingAccountController } from '@/modules/trading-accounts/controllers/trading-account.controller';
import { TradingAccountOrdersController } from '@/modules/trading-accounts/controllers/trading-account-orders.controller';
import { PrivyAppService } from '@/modules/trading-accounts/services/privy-app.service';
import { TradingAccountOnboardingService } from '@/modules/trading-accounts/services/trading-account-onboarding.service';
import { TradingAccountPortfolioService } from '@/modules/trading-accounts/services/trading-account-portfolio.service';
import { DirectRedeemService } from '@/modules/trading-accounts/services/direct-redeem.service';
import { DirectWithdrawService } from '@/modules/trading-accounts/services/direct-withdraw.service';
import { TradingAccountRedeemableService } from '@/modules/trading-accounts/services/trading-account-redeemable.service';
import { DirectBuyService } from '@/modules/trading-accounts/services/direct-buy.service';
import { DirectSellService } from '@/modules/trading-accounts/services/direct-sell.service';
import { DirectOrderLifecycleService } from '@/modules/trading-accounts/services/direct-order-lifecycle.service';
import { DirectOrderQueryService } from '@/modules/trading-accounts/services/direct-order-query.service';
import { AuthorizationSetupMapper } from '@/modules/trading-accounts/mappers/authorization-setup.mapper';
import { TradingPolicyInputMapper } from '@/modules/trading-accounts/mappers/trading-policy-input.mapper';
import { canonicalPrivyPayload } from '@/modules/trading-accounts/utils/canonical-privy-payload';
import { CombosController } from '@/modules/combos/controllers/combos.controller';
import { ComboExecutionService } from '@/modules/combos/services/combo-execution.service';
import { ComboLegsService } from '@/modules/combos/services/combo-legs.service';
import { ComboQueryService } from '@/modules/combos/services/combo-query.service';
import { ComboRedemptionService } from '@/modules/combos/services/combo-redemption.service';
import { ComboOrderMapper } from '@/modules/combos/mappers/combo-order.mapper';
import { ComboOrderDirection, ComboOrderStatus } from '@/core';

const SDK_DIR = process.env.SDK_DIR || resolve(__dirname, '..');
const STATE_FILE = join(tmpdir(), `predikt-fake-privy-${process.pid}.json`);
const INTEGRATOR_ID = randomUUID();
const PRIVY_APP = 'cmprivyappe2e000000000001';
const PRIVY_WALLET = 'e2ewalletid0000000000001';
const OWNER_ID = 'owner-quorum-e2e';
const PREDIKT_SIGNER = 'predikt-signer-e2e';
const SIGNER_ADDRESS = '0x3434343434343434343434343434343434343434';
const DEPOSIT = '0xab466971e81fd723dbeef85dd37cb3993ff89b38';
const ACCOUNT_ID = randomUUID();
const owner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

// ─── Stateful fakes ──────────────────────────────────────────────────────────

const privy = {
  wallet: { id: PRIVY_WALLET, address: getAddress(SIGNER_ADDRESS), owner_id: OWNER_ID, additional_signers: [] as any[] },
  policies: {} as Record<string, unknown>,
};
const savePrivy = () => writeFileSync(STATE_FILE, JSON.stringify(privy));

let active: { max: string; expiresAt: Date } | null = null;
let pending: { approval: any; max: string; expiresAt: Date } | null = null;
const activations: string[] = [];

function issue(max: string, expiresAt: string) {
  const g = {
    id: randomUUID(), delegatedSignerId: PREDIKT_SIGNER, allowedActions: ['buy', 'sell', 'redeem', 'cancel'],
    maxBuyAmountPerOrder: max, expiresAt: new Date(expiresAt),
    tradingAccount: { privyWalletId: PRIVY_WALLET, walletConnection: { privyAppId: PRIVY_APP } },
  } as any;
  const policyId = `policy-${g.id.slice(0, 8)}`;
  const policy = new TradingPolicyInputMapper().toPolicy(
    { expiresAt: g.expiresAt.toISOString(), signerAddress: SIGNER_ADDRESS, depositWalletAddress: DEPOSIT } as any, g.id, OWNER_ID,
  );
  const checksum = (v: unknown) => (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v) : v);
  privy.policies[policyId] = {
    id: policyId, ...policy,
    rules: policy.rules.map((rule, i) => ({ id: `r${i}`, ...rule, conditions: (rule.conditions as any[]).map((c) => ({ ...c, value: checksum(c.value) })) })),
  };
  savePrivy();
  const mapper = new AuthorizationSetupMapper({} as any);
  const signers = privy.wallet.additional_signers.map((s) => ({ signerId: s.signer_id, overridePolicyIds: s.override_policy_ids }));
  const doc = mapper.prepare(g, { ownerId: OWNER_ID, policyId } as any, { ownerId: OWNER_ID, additionalSigners: signers } as any, Date.now());
  pending = { approval: mapper.toResponse(g, doc), max, expiresAt: g.expiresAt };
}

/** Built by the backend's real onboarding mapper (incl. `activeGrant`). */
const accountView = () => {
  const grant = (g: { max: string; expiresAt: Date } | null) =>
    g && {
      id: randomUUID(),
      maxBuyAmountPerOrder: g.max,
      expiresAt: g.expiresAt.toISOString(),
      policyProfile: 'polymarket-privy-1271-broad-batch-v4',
    };
  const account = Object.assign(new TradingAccount(), {
    id: ACCOUNT_ID, privyWalletId: PRIVY_WALLET, depositWalletAddress: DEPOSIT, status: TradingAccountStatus.ACTIVE,
  });
  return new TradingAccountOnboardingMapper().toResponse(
    account,
    { version: 1, activeAuthorization: grant(active), pendingAuthorization: grant(pending) } as never,
    pending?.approval ?? null,
  );
};

const onboarding = {
  register: async (_c: unknown, input: { maxBuyAmountPerOrder: string; expiresAt: string }) => {
    if (active && !pending) {
      if (active.max !== input.maxBuyAmountPerOrder || active.expiresAt.getTime() !== new Date(input.expiresAt).getTime())
        throw new ConflictException('TRADING_AUTHORIZATION_EXISTS', { userMessage: 'Different limits.' });
      return accountView();
    }
    if (!pending) issue(input.maxBuyAmountPerOrder, input.expiresAt);
    return accountView();
  },
  reauthorize: async (_c: unknown, _id: string, input: { maxBuyAmountPerOrder: string; expiresAt: string }) => {
    issue(input.maxBuyAmountPerOrder, input.expiresAt);
    return accountView();
  },
  activate: async (_c: unknown, _id: string, input: { approvalDigest: string; signatures: string[] }) => {
    if (!pending) throw new ConflictException('TRADING_ACCOUNT_NOT_AWAITING_APPROVAL', { userMessage: 'Nothing to activate.' });
    const payload = pending.approval.signaturePayload;
    const ok = input.approvalDigest === pending.approval.approvalDigest &&
      verify('sha256', Buffer.from(canonicalPrivyPayload(payload)), owner.publicKey, Buffer.from(input.signatures[0], 'base64'));
    if (!ok) throw new ConflictException('PRIVY_SETUP_REJECTED', { userMessage: 'Privy rejected the signature.' });
    privy.wallet.additional_signers = payload.body.additional_signers;
    savePrivy();
    active = { max: pending.max, expiresAt: pending.expiresAt };
    pending = null;
    activations.push(active.max);
    return accountView();
  },
  get: async () => accountView(),
};

const directOrders = new Map<string, any>();
function directOrder(side: string, key: string, extra: Record<string, unknown>) {
  const existing = [...directOrders.values()].find((o) => o.key === key);
  if (existing) return existing.view;
  const view = {
    orderId: randomUUID(), accountId: ACCOUNT_ID, side, source: 'integrator', status: 'filled', tokenId: '5511', conditionId: null,
    redeemedPositions: null, amount: '1000000', principal: null, slippagePercent: '5', bestPriceAtOrder: '0.2', limitPrice: '0.21',
    clobOrderId: '0x1', spentAmount: null, receivedAmount: null, filledShares: '5000000', transactionHashes: ['0x2'], reasonCode: null, fees: null,
    ...extra,
  };
  directOrders.set(view.orderId, { key, view });
  return view;
}

const comboMapper = new ComboOrderMapper();
const combos = new Map<string, any>();
const MARKETS = [
  { marketId: '11', tags: ['sports'], price: '0.92' },
  { marketId: '12', tags: ['politics'], price: '0.5' },
  { marketId: '13', tags: ['politics'], price: '0.45' },
  { marketId: '14', tags: ['crypto'], price: '0.55' },
].map((m) => ({ marketId: m.marketId, conditionId: `0x${m.marketId}`, slug: `m-${m.marketId}`, title: `Market ${m.marketId}`, outcomes: ['Yes', 'No'], prices: [m.price, String(1 - Number(m.price))], positionIds: ['1', '2'], image: null, volume: 1, tags: m.tags }));

function comboEntity(entity: any, fill: Record<string, unknown>) {
  return { id: randomUUID(), source: 'API', status: ComboOrderStatus.FILLED, comboPositionId: '1731', rfqId: 'rfq', quotedPriceE6: '260000', effectivePriceE6: '270000', makerAmountE6: null, totalRequiredE6: null, netReceiveE6: null, txHash: '0xfeed', errorCode: null, errorMessage: null, createdAt: new Date(), filledAt: new Date(), ...entity, ...fill };
}
const legsOf = (legs: { marketId: string; outcome: number }[]) => legs.map((l) => ({ ...l, positionId: '1', title: `Market ${l.marketId}`, outcomeLabel: l.outcome ? 'No' : 'Yes', price: '0.5' }));
function requireOwnWallet(wallet: string) {
  if (wallet.toLowerCase() !== DEPOSIT) throw new AuthException('COMBO_WALLET_NOT_ALLOWED', { userMessage: 'Not your wallet.', httpStatus: 403 });
}

const providers = [
  { provide: IntegratorContextService, useValue: { require: () => INTEGRATOR_ID, getApiKeyId: () => 'key' } },
  { provide: PrivyAppService, useValue: { connect: async (_c: unknown, i: any) => ({ appId: i.appId, environment: i.environment, status: 'active' }), get: async () => ({}) } },
  { provide: TradingAccountOnboardingService, useValue: onboarding },
  { provide: TradingAccountPortfolioService, useValue: { get: async () => ({ accountId: ACCOUNT_ID, status: 'active', tradingAddress: DEPOSIT, balances: { pusd: '5000000', usdce: '0' }, positions: [], positionsError: null, asOf: new Date().toISOString() }) } },
  { provide: TradingAccountRedeemableService, useValue: { get: async () => ({ accountId: ACCOUNT_ID, markets: [], asOf: new Date().toISOString() }) } },
  { provide: DirectBuyService, useValue: { buy: async (_c: unknown, _id: string, i: any) => directOrder('buy', i.idempotencyKey, { amount: i.amount, spentAmount: '1000000' }) } },
  { provide: DirectSellService, useValue: { sell: async (_c: unknown, _id: string, i: any) => directOrder('sell', i.idempotencyKey, { side: 'sell', amount: '5000000', receivedAmount: '990000' }) } },
  { provide: DirectRedeemService, useValue: { redeem: async (_c: unknown, _id: string, i: any) => directOrder('redeem', i.idempotencyKey, { status: 'rejected', reasonCode: 'REDEEMED_BY_POLYMARKET', tokenId: null, conditionId: i.conditionId }) } },
  { provide: DirectWithdrawService, useValue: { withdraw: async (_c: unknown, _id: string, i: any) => directOrder('withdraw', i.idempotencyKey, { status: 'withdrawn', tokenId: null, amount: i.amount === 'all' ? '5000000' : i.amount, filledShares: null, transactionHashes: ['0xwithdraw'] }) } },
  { provide: DirectOrderLifecycleService, useValue: { get: async (_i: string, _a: string, id: string) => directOrders.get(id)?.view } },
  { provide: DirectOrderQueryService, useValue: { list: async () => ({ orders: [...directOrders.values()].map((o) => o.view), nextCursor: 'c1', hasMore: false }) } },
  {
    provide: ComboExecutionService,
    useValue: {
      buy: async (i: any) => {
        if (combos.has(i.clientOrderId)) {
          const existing = combos.get(i.clientOrderId);
          assertSameComboRequest(existing, {
            direction: ComboOrderDirection.BUY, walletAddress: i.walletAddress, requestedSizeE6: i.amount,
            limitPriceE6: toE6(i.maxPrice).toString(), legs: i.legs,
          });
          return existing;
        }
        requireOwnWallet(i.walletAddress);
        const entity = comboEntity(comboMapper.toBuyEntity(i, legsOf(i.legs) as any), { comboConditionId: '0x03d3', totalRequiredE6: i.amount, netReceiveE6: '3703703' });
        combos.set(i.clientOrderId, entity);
        return entity;
      },
      sell: async (i: any) => {
        requireOwnWallet(i.walletAddress);
        const entity = comboEntity(comboMapper.toSellEntity(i, legsOf([]) as any, '1731'), { makerAmountE6: i.shares, netReceiveE6: '950000' });
        combos.set(i.clientOrderId, entity);
        return entity;
      },
    },
  },
  { provide: ComboLegsService, useValue: { quote: async (legs: any[], amount: string) => ({ indicativePrice: '0.25', estimatedShares: String(Number(amount) * 4), potentialPayout: String(Number(amount) * 4), legs: legsOf(legs) }) } },
  {
    provide: ComboQueryService,
    useValue: {
      listMarkets: async () => ({ markets: MARKETS, nextCursor: null }),
      getOrder: async (_i: string, id: string) => comboMapper.toResponse([...combos.values()].find((o) => o.id === id)),
      listOrders: async () => ({ data: [...combos.values()].map((o) => comboMapper.toResponse(o)), pagination: { currentPage: 1, itemsPerPage: 100, totalItems: combos.size, totalPages: 1, hasNext: false, hasPrev: false } }),
      listPositions: async () => ({ data: [] }),
      listActivity: async () => ({ data: [] }),
    },
  },
  { provide: ComboRedemptionService, useValue: { redeem: async () => { throw new ConflictException('COMBO_NOT_REDEEMABLE', { userMessage: 'Not resolved.' }); } } },
  ComboOrderMapper,
];

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  savePrivy();
  @Module({ controllers: [PrivyAppController, TradingAccountController, TradingAccountOrdersController, CombosController], providers })
  class E2eModule {}
  app = await NestFactory.create(E2eModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter({ warn: () => undefined, error: () => undefined } as never));
  await app.listen(0, '127.0.0.1');
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
});

async function runScript(extraEnv: Record<string, string>) {
  const env = {
    ...process.env,
    NODE_OPTIONS: `--import ${__dirname}/privy-preload.mjs`,
    FAKE_PRIVY_STATE: STATE_FILE,
    PREDIKT_API_URL: baseUrl,
    PREDIKT_API_KEY: 'sk_predikt_e2e',
    PRIVY_APP_ID: PRIVY_APP,
    PRIVY_APP_SECRET: 'secret',
    PRIVY_OWNER_KEY: `wallet-auth:${owner.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}`,
    PRIVY_WALLET_ID: PRIVY_WALLET,
    E2E_EXPIRES_AT: '2027-12-31T00:00:00Z',
    ...extraEnv,
  };
  return promisify(execFile)('node', [`${SDK_DIR}/scripts/e2e-checklist.mjs`], { env, cwd: SDK_DIR }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e: any) => ({ code: e.code, out: `${e.stdout}${e.stderr}` }),
  );
}

it('runs the whole checklist with trading enabled, then again (re-run safe)', async () => {
  const first = await runScript({ E2E_TRADE: '1', E2E_TOKEN_ID: '5511', E2E_REDEEM_CONDITION_ID: `0x${'cd'.repeat(32)}`, E2E_WITHDRAW_AMOUNT: 'all' });
  console.log(first.out);
  expect(first.code).toBe(0);
  expect(first.out).not.toContain('✗');
  for (const id of ['1', '2', '3', '4', '5r', '5', '6', '7', '7b', '10', '8', '9', '11/12', '13']) expect(first.out).toMatch(new RegExp(`✓ ${id.replace('/', '\\/')} `));
  expect(activations).toEqual(['2000000', '3000000', '2000000']);
  expect(first.out).toMatch(/✓ 13 Withdraw pUSD to the Privy wallet — withdrew 5 pUSD to the Privy wallet \(tx 0xwithdraw\)/);

  const kept = await runScript({ E2E_TRADE: '1', E2E_KEEP_COMBO: '1' });
  expect(kept.code).toBe(0);
  expect(kept.out).toMatch(/- 8 Combo sell \(full cash-out\): skipped \(E2E_KEEP_COMBO=1 keeps combo 0x03d3/);
  expect(kept.out).toContain('- 13 Withdraw pUSD to the Privy wallet: skipped (set E2E_WITHDRAW_AMOUNT)');

  const second = await runScript({});
  console.log(second.out);
  expect(second.code).toBe(0);
  expect(second.out).toContain('- 6 Combo quote + buy: skipped');
  expect(second.out).toMatch(/✓ 2 .*active → active/);
});
