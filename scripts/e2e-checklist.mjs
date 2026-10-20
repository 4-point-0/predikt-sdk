#!/usr/bin/env node
/**
 * Live end-to-end checklist for direct trading and Polymarket Combos (backend
 * docs/SDK_INTEGRATION_GUIDE.md, section 9), run through the built SDK against a real Predikt API
 * with a test Privy wallet.
 *
 * Onboarding and read-only steps always run (approvals are free). Steps that move funds run only
 * with E2E_TRADE=1; use a test wallet holding a few pUSD.
 *
 * Required:
 *   PREDIKT_API_URL, PREDIKT_API_KEY (backend key), PRIVY_APP_ID, PRIVY_APP_SECRET,
 *   PRIVY_OWNER_KEY (base64 PKCS#8 or PEM), PRIVY_WALLET_ID
 * Optional:
 *   PRIVY_ENVIRONMENT        production | development (default production)
 *   E2E_MAX_BUY              grant cap, base units (default 2000000)
 *   E2E_EXPIRES_AT           grant expiry, ISO (default Dec 31 of next year; keep it stable across runs)
 *   E2E_TRADE=1              run the steps that trade
 *   E2E_COMBO_AMOUNT         combo budget, base units (default 1000000)
 *   E2E_COMBO_LEGS           "marketId:outcome,marketId:outcome" (default: picked automatically)
 *   E2E_KEEP_COMBO=1         skip the cash-out (step 8) and keep the ticket, e.g. to test payouts
 *   E2E_TOKEN_ID             direct buy then sell "all" of this outcome token
 *   E2E_DIRECT_AMOUNT        direct buy budget, base units (default 2000000; Polymarket rejects buys under $1
 *                            after the ~3% fee reserve, and under ~5 shares)
 *   E2E_REDEEM_CONDITION_ID  direct redeem of a resolved market held by the wallet
 *
 * Usage: cp e2e.env.example e2e.env (fill it in), then
 *   npm run build && node --env-file=e2e.env scripts/e2e-checklist.mjs
 */
import { randomUUID } from 'node:crypto';
import { fromBaseUnits, isReauthorizationPending, PrediktSDK } from '../dist/esm/index.js';
import { verifyAndSignApproval } from '../dist/esm/server.js';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. See the header of this script.`);
    process.exit(2);
  }
  return value;
}

/** An optional variable; empty (as left in e2e.env) counts as unset. */
function optional(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

const env = {
  apiUrl: required('PREDIKT_API_URL'),
  apiKey: required('PREDIKT_API_KEY'),
  privyAppId: required('PRIVY_APP_ID'),
  privyAppSecret: required('PRIVY_APP_SECRET'),
  ownerKey: required('PRIVY_OWNER_KEY'),
  privyWalletId: required('PRIVY_WALLET_ID'),
  environment: optional('PRIVY_ENVIRONMENT', 'production'),
  maxBuy: optional('E2E_MAX_BUY', '2000000'),
  expiresAt: optional('E2E_EXPIRES_AT', `${new Date().getUTCFullYear() + 1}-12-31T00:00:00Z`),
  trade: optional('E2E_TRADE') === '1',
  comboAmount: optional('E2E_COMBO_AMOUNT', '1000000'),
  comboLegs: optional('E2E_COMBO_LEGS'),
  keepCombo: optional('E2E_KEEP_COMBO') === '1',
  tokenId: optional('E2E_TOKEN_ID'),
  directAmount: optional('E2E_DIRECT_AMOUNT', '2000000'),
  redeemConditionId: optional('E2E_REDEEM_CONDITION_ID'),
};

const EXCHANGE_V3 = '0xe3333700ca9d93003f00f0f71f8515005f6c00aa';
const sdk = new PrediktSDK({ baseUrl: env.apiUrl, apiKey: env.apiKey, timeoutMs: 60_000 });
const run = randomUUID().slice(0, 8);
const results = [];
const state = { account: null, policyId: null, combo: null };

const describe = (error) => (error?.code ? `${error.code}: ${error.message}` : (error?.message ?? String(error)));

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function step(id, name, fn, { trade = false } = {}) {
  if (trade && !env.trade) {
    results.push({ id, name, result: 'SKIP', note: 'set E2E_TRADE=1' });
    console.log(`- ${id} ${name}: skipped (set E2E_TRADE=1)`);
    return;
  }
  try {
    const note = (await fn()) ?? '';
    if (note.startsWith('SKIP: ')) {
      results.push({ id, name, result: 'SKIP', note: note.slice(6) });
      console.log(`- ${id} ${name}: skipped (${note.slice(6)})`);
      return;
    }
    results.push({ id, name, result: 'PASS', note });
    console.log(`✓ ${id} ${name}${note ? ` — ${note}` : ''}`);
  } catch (error) {
    results.push({ id, name, result: 'FAIL', note: describe(error) });
    console.log(`✗ ${id} ${name} — ${describe(error)}`);
  }
}

async function expectError(promise, status, code) {
  try {
    await promise;
  } catch (error) {
    check(error?.status === status && error?.code === code, `expected ${status} ${code}, got ${describe(error)}`);
    return `${status} ${code}`;
  }
  throw new Error(`expected ${status} ${code}, but the call succeeded`);
}

/** Verifies and signs a pending approval with the owner key, then activates it. */
async function approve(pending, limits) {
  if (pending.status !== 'awaiting_owner_approval') return pending;
  state.policyId = pending.approval.policyId;
  const signed = await verifyAndSignApproval(pending, {
    ownerKey: env.ownerKey,
    privyAppId: env.privyAppId,
    privyAppSecret: env.privyAppSecret,
    expected: { privyWalletId: env.privyWalletId, ...limits },
  });
  return sdk.accounts.activate(pending, signed);
}

function requireAccount() {
  check(state.account?.status === 'active', 'needs the active account from step 2');
  return state.account;
}

function requireCombo() {
  check(state.combo?.status === 'FILLED', 'needs the FILLED combo from step 6');
  return state.combo;
}

async function pickLegs() {
  if (env.comboLegs) {
    return env.comboLegs.split(',').map((leg) => {
      const [marketId, outcome] = leg.split(':');
      return { marketId, outcome: Number(outcome) };
    });
  }
  // Legs priced ~0.4–0.6 from unrelated markets get quotes most easily.
  const picked = [];
  let scanned = 0;
  for await (const market of sdk.combos.iterateMarkets({ limit: 200 })) {
    if (++scanned > 1000) break;
    const price = Number(market.prices[0]);
    if (!(price >= 0.35 && price <= 0.65)) continue;
    if (picked.some((other) => other.tags.some((tag) => market.tags.includes(tag)))) continue;
    picked.push(market);
    if (picked.length === 2) break;
  }
  check(picked.length === 2, 'no two suitable combo markets found; set E2E_COMBO_LEGS');
  return picked.map((market) => ({ marketId: market.marketId, outcome: 0 }));
}

const limits = { maxBuyAmountPerOrder: env.maxBuy, expiresAt: env.expiresAt };

console.log(`Predikt e2e checklist (run ${run}) against ${env.apiUrl}${env.trade ? ' — TRADING ENABLED' : ''}\n`);

await step('1', 'Connect Privy app', async () => {
  const app = await sdk.privyApp.connect({ appId: env.privyAppId, environment: env.environment });
  check(app.status === 'active', `status ${app.status}`);
  return `app ${app.appId} active`;
});

await step('2', 'Register wallet → verify + sign → activate', async () => {
  const pending = await sdk.accounts.register({ privyWalletId: env.privyWalletId, ...limits }).catch((error) => {
    if (error?.code === 'TRADING_AUTHORIZATION_EXISTS') {
      error.message += ' (set E2E_MAX_BUY and E2E_EXPIRES_AT to the wallet\'s current limits)';
    }
    throw error;
  });
  const before = pending.status;
  state.account = await approve(pending, limits);
  check(state.account.status === 'active', `status ${state.account.status}`);
  return `${before} → active; account ${state.account.accountId}, deposit wallet ${state.account.depositWalletAddress}`;
});

await step('3', 'Reauthorize with new limits → still trading while pending → active with new limits, then restore', async () => {
  const account = requireAccount();
  const raised = { ...limits, maxBuyAmountPerOrder: (BigInt(env.maxBuy) + 1_000_000n).toString() };
  const pending = await sdk.accounts.reauthorize(account, raised);
  // Until activation the account trades under its current grant (`activeGrant`).
  const during = await sdk.accounts.get(account);
  check(isReauthorizationPending(during), `pending re-authorization not visible (status ${during.status}, activeGrant ${JSON.stringify(during.activeGrant)})`);
  check(during.activeGrant.maxBuyAmountPerOrder === env.maxBuy, `activeGrant cap ${during.activeGrant.maxBuyAmountPerOrder}`);
  const updated = await approve(pending, raised);
  check(updated.status === 'active', `status ${updated.status}`);
  check(updated.maxBuyAmountPerOrder === raised.maxBuyAmountPerOrder, `cap ${updated.maxBuyAmountPerOrder}`);
  // Restore the original limits so the next run's register call matches the grant.
  state.account = await approve(await sdk.accounts.reauthorize(account, limits), limits);
  check(state.account.maxBuyAmountPerOrder === env.maxBuy, 'restore failed');
  return `pending shown with activeGrant ${fromBaseUnits(env.maxBuy)}; cap ${fromBaseUnits(raised.maxBuyAmountPerOrder)} pUSD activated, restored to ${fromBaseUnits(env.maxBuy)}`;
});

await step('4', 'Privy policy contains the Exchange v3 (Combos) rule', async () => {
  check(state.policyId, 'no policy approved in this run (step 3 failed?)');
  const auth = Buffer.from(`${env.privyAppId}:${env.privyAppSecret}`).toString('base64');
  const response = await fetch(`https://api.privy.io/v1/policies/${state.policyId}`, {
    headers: { 'privy-app-id': env.privyAppId, Authorization: `Basic ${auth}` },
  });
  check(response.ok, `Privy returned ${response.status}`);
  const policy = await response.json();
  const v3 = policy.rules.some((rule) =>
    rule.conditions.some((c) => c.field === 'verifyingContract' && String(c.value).toLowerCase() === EXCHANGE_V3),
  );
  check(v3, 'no rule for Exchange v3');
  // The API reports the same through the grant's recorded policy profile.
  const account = await sdk.accounts.get(requireAccount());
  check(account.activeGrant?.combosEnabled === true, `activeGrant.combosEnabled is ${account.activeGrant?.combosEnabled}`);
  return `policy ${state.policyId}, ${policy.rules.length} rules; activeGrant ${account.activeGrant.policyProfile}, combosEnabled`;
});

await step('5r', 'Portfolio, redeemable and order change feed (read-only)', async () => {
  const account = requireAccount();
  const portfolio = await sdk.accounts.portfolio(account);
  const redeemable = await sdk.accounts.redeemable(account);
  const page = await sdk.trading.listOrderChanges(account, { limit: 5 });
  return `pUSD ${fromBaseUnits(portfolio.balances.pusd)}, ${portfolio.positions?.length ?? 'n/a'} positions, ${redeemable.markets.length} redeemable, feed ok (${page.orders.length} orders)`;
});

await step('5', 'Direct buy / sell / redeem', async () => {
  const account = requireAccount();
  const notes = [];
  if (env.tokenId) {
    const buy = await sdk.trading.buy(account, { tokenId: env.tokenId, amount: env.directAmount, idempotencyKey: `e2e-buy-${run}` });
    const bought = await sdk.trading.waitForOrder(account, buy);
    check(bought.status === 'filled', `buy ${bought.status} ${bought.reasonCode ?? ''}`);
    const sell = await sdk.trading.sell(account, { tokenId: env.tokenId, shares: 'all', idempotencyKey: `e2e-sell-${run}` });
    const sold = await sdk.trading.waitForOrder(account, sell);
    check(sold.status === 'filled', `sell ${sold.status} ${sold.reasonCode ?? ''}`);
    notes.push(`bought ${fromBaseUnits(bought.filledShares)} for ${fromBaseUnits(bought.spentAmount)}, sold for ${fromBaseUnits(sold.receivedAmount)}`);
  }
  if (env.redeemConditionId) {
    const redeem = await sdk.trading.redeem(account, { conditionId: env.redeemConditionId, idempotencyKey: `e2e-redeem-${run}` });
    const done = await sdk.trading.waitForOrder(account, redeem);
    check(done.status === 'redeemed' || done.reasonCode === 'REDEEMED_BY_POLYMARKET', `redeem ${done.status} ${done.reasonCode ?? ''}`);
    notes.push(`redeem ${done.status}${done.reasonCode ? ` (${done.reasonCode})` : ''}${done.receivedAmount ? ` ${fromBaseUnits(done.receivedAmount)}` : ''}`);
  }
  return notes.length ? notes.join('; ') : 'SKIP: set E2E_TOKEN_ID and/or E2E_REDEEM_CONDITION_ID';
}, { trade: true });

await step('6', 'Combo quote + buy', async () => {
  const account = requireAccount();
  const legs = await pickLegs();
  const quote = await sdk.combos.quote({ legs, amount: env.comboAmount });
  const maxPrice = Math.min(0.99, Number(quote.indicativePrice) * 1.15).toFixed(4);
  const order = await sdk.combos.buy({ wallet: account, legs, amount: env.comboAmount, maxPrice, clientOrderId: `e2e-combo-${run}` });
  state.combo = await sdk.combos.waitForOrder(order);
  check(state.combo.status === 'FILLED', `status ${state.combo.status} ${state.combo.error?.code ?? ''}`);
  check(state.combo.txHash, 'no txHash');
  return `indicative ${quote.indicativePrice}, max ${maxPrice}, effective ${state.combo.effectivePrice}, ${fromBaseUnits(state.combo.shares)} shares, combo ${state.combo.comboConditionId}, tx ${state.combo.txHash}`;
}, { trade: true });

await step('7', 'Combo buy again with the same clientOrderId → same order', async () => {
  const combo = requireCombo();
  const again = await sdk.combos.buy({
    wallet: requireAccount(),
    legs: combo.legs.map(({ marketId, outcome }) => ({ marketId, outcome })),
    amount: combo.requestedAmount,
    maxPrice: combo.limitPrice,
    clientOrderId: combo.clientOrderId,
  });
  check(again.id === combo.id, `got another order ${again.id}`);
  return `same order ${again.id}`;
}, { trade: true });

await step('7b', 'Same clientOrderId with a different amount → 409 COMBO_CLIENT_ORDER_ID_REUSED from the API', async () => {
  const combo = requireCombo();
  try {
    await sdk.combos.buy({
      wallet: requireAccount(),
      legs: combo.legs.map(({ marketId, outcome }) => ({ marketId, outcome })),
      amount: (BigInt(combo.requestedAmount) + 1n).toString(),
      maxPrice: combo.limitPrice,
      clientOrderId: combo.clientOrderId,
    });
  } catch (error) {
    check(error?.status === 409 && error?.code === 'COMBO_CLIENT_ORDER_ID_REUSED', `got ${describe(error)}`);
    // `raisedBy: 'sdk'` would mean the API returned the old order and only the SDK caught it.
    check(error.details?.raisedBy !== 'sdk', 'the API returned the old order; only the SDK fallback check caught it');
    return `409 ${error.code} (existing order ${error.orderId})`;
  }
  throw new Error('expected 409 COMBO_CLIENT_ORDER_ID_REUSED, but the call succeeded');
}, { trade: true });

await step('10', 'Combo redeem before resolution → 409 COMBO_NOT_REDEEMABLE', async () => {
  const combo = requireCombo();
  return expectError(
    sdk.combos.redeem({ wallet: requireAccount(), comboConditionId: combo.comboConditionId, clientOrderId: `e2e-early-redeem-${run}` }),
    409,
    'COMBO_NOT_REDEEMABLE',
  );
}, { trade: true });

await step('8', 'Combo sell (full cash-out)', async () => {
  const combo = requireCombo();
  if (env.keepCombo) return `SKIP: E2E_KEEP_COMBO=1 keeps combo ${combo.comboConditionId} for the payout test`;
  const minPrice = Math.max(0.01, Number(combo.effectivePrice) * 0.5).toFixed(4);
  const order = await sdk.combos.sell({
    wallet: requireAccount(),
    comboConditionId: combo.comboConditionId,
    shares: combo.shares,
    minPrice,
    clientOrderId: `e2e-combo-sell-${run}`,
  });
  const sold = await sdk.combos.waitForOrder(order);
  check(sold.status === 'FILLED', `status ${sold.status} ${sold.error?.code ?? ''}`);
  return `sold ${fromBaseUnits(sold.shares)} shares for ${fromBaseUnits(sold.amount)} pUSD`;
}, { trade: true });

await step('9', 'Combo buy with a wallet that is not yours → 403 COMBO_WALLET_NOT_ALLOWED', async () =>
  expectError(
    sdk.combos.buy({
      wallet: `0x${'0'.repeat(39)}1`,
      legs: [{ marketId: '1', outcome: 0 }, { marketId: '2', outcome: 0 }],
      amount: '1000000',
      maxPrice: '0.5',
      clientOrderId: `e2e-foreign-${run}`,
    }),
    403,
    'COMBO_WALLET_NOT_ALLOWED',
  ),
);

await step('11/12', 'Combo payouts recorded so far (REDEEM orders, both sources)', async () => {
  const account = requireAccount();
  const counts = {};
  for await (const order of sdk.combos.iterateOrders({ wallet: account, status: 'FILLED' })) {
    if (order.direction === 'REDEEM') counts[order.source] = (counts[order.source] ?? 0) + 1;
  }
  return `POLYMARKET_AUTO ${counts.POLYMARKET_AUTO ?? 0}, API ${counts.API ?? 0} (resolve a combo and re-run to verify)`;
});

console.log('\nSummary');
console.table(results);
process.exit(results.some((r) => r.result === 'FAIL') ? 1 : 0);
