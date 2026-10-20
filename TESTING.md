# Testing the SDK

How to verify the direct-trading and Polymarket Combos support in `@prediktgg/sdk`, from fast
local tests to a live run on Polygon. Do the levels in order; each one assumes the previous passed.

| Level | Proves | Needs | Time | Real money |
| --- | --- | --- | --- | --- |
| [1. Unit tests](#1-unit-tests) | SDK logic: requests, errors, retries, polling, approval checks | Node, this repo | < 1 min | no |
| [2. Contract tests](#2-contract-tests-against-the-backend-code) | The built SDK works with the backend's real controllers, validation, error filter and mappers | Backend checkout with `npm ci` | 1–2 min | no |
| [3. Package check](#3-package-check-before-publishing) | The packed npm package installs and imports (ESM, CJS, TypeScript) | Network | 2 min | no |
| [4. Live end-to-end](#4-live-end-to-end-checklist) | Everything against the real Predikt API, Privy and Polymarket | API key, Privy app, owner key, a test wallet with ~5 pUSD | 30 min (+ waiting for a market to resolve for payouts) | yes, a few dollars |

Folder layout used below (the backend location can be overridden with `BACKEND_DIR`):

```
predikt-sdk/
├── predikt-aggregator/   # backend, branch integrator/polymarket-path
└── predikt-sdk/          # this repo
```

Requirements: Node 20 or newer for development (the published package supports Node ≥ 18) and npm.

---

## 1. Unit tests

```bash
cd predikt-sdk
npm ci
npm run typecheck     # src + test, strict
npm test              # vitest
npm run build
```

Expected: `typecheck` prints nothing, and `npm test` ends with:

```
 Test Files  6 passed (6)
      Tests  158 passed (158)
```

What they cover (`test/`):

| File | Covers |
| --- | --- |
| `approval.test.ts` | `canonicalJson` (RFC 8785 vectors, other JS realms); `verifyAndSignApproval`: a valid registration and re-authorization are signed (signature verified with the public key), and every refusal case (digest, wallet, request expiry, signers, owner, each kind of bad policy rule, limits, Privy errors, bad owner keys) fails with its exact `code` |
| `http.test.ts` | API error mapping (`code`, `details`, `orderId`, `retryable`, 429 `Retry-After`), timeouts, retries (network, 503 retryable, `TRADING_APPROVALS_PENDING`) and when not to retry (4xx, 429, 5xx with a recorded `orderId`, older endpoints) |
| `accounts.test.ts` | Privy app, `register` repeating while `provisioning`, activate/reauthorize bodies, `isReauthorizationPending` |
| `trading.test.ts` | Direct buy/sell/redeem bodies, order change feed paging, `isDirectOrderFinal`, `waitForOrder` (incl. transient poll failures) |
| `combos.test.ts` | Combo endpoints and queries, iterators, `waitForOrder`, `clientOrderId` reuse (API 409 and the SDK's own fallback check) |
| `units.test.ts` | `toBaseUnits` / `fromBaseUnits` |

To run a single file: `npx vitest run test/approval.test.ts`.

---

## 2. Contract tests against the backend code

These start the backend's **real** NestJS controllers (`/direct/*`, `/combos/*`) on a random local
port, with the same global `ValidationPipe` and `GlobalExceptionFilter` as `src/main.ts`. The
services behind the controllers are mocked, except for the parts under test, which are real:

- the onboarding mapper (`activeGrant`);
- `ComboExecutionService`, with an in-memory repository (the `409 COMBO_CLIENT_ORDER_ID_REUSED`);
- `AuthorizationSetupMapper` and `TradingPolicyInputMapper`, which build the approvals and policies
  that the SDK verifies and signs. A fake Privy then checks the signature with the backend's own
  canonicalization.

They also run `scripts/e2e-checklist.mjs` as a real child process against this setup. No
database, Redis, network or keys are needed.

One-time setup of the backend checkout:

```bash
cd predikt-aggregator
git checkout integrator/polymarket-path
npm ci
```

Run:

```bash
cd predikt-sdk
npm run test:contract
# backend elsewhere:  BACKEND_DIR=/path/to/predikt-aggregator npm run test:contract
```

Expected:

```
Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total
```

The files are in `contract/`. They use the backend's jest and `node_modules` (see
`contract/run.mjs`), and are not part of `npm test` or the published package. Run them after every
backend change to `/direct` or `/combos`, and before releasing the SDK.

---

## 3. Package check (before publishing)

Checks that the packed tarball imports correctly as an npm user would get it. Run it from the SDK
repo:

```bash
npm run build
TMP=$(mktemp -d) && npm pack --pack-destination "$TMP" && cd "$TMP"
npm init -y >/dev/null
npm install ./prediktgg-sdk-*.tgz typescript@5 @types/node@20

cat > esm.mjs <<'EOF'
import { PrediktSDK, toBaseUnits } from '@prediktgg/sdk';
import { verifyAndSignApproval } from '@prediktgg/sdk/server';
const sdk = new PrediktSDK({ baseUrl: 'http://localhost', apiKey: 'k' });
console.log('esm', typeof sdk.combos.buy, typeof verifyAndSignApproval, toBaseUnits('2.5'));
EOF
cat > cjs.cjs <<'EOF'
const { PrediktSDK } = require('@prediktgg/sdk');
const { verifyAndSignApproval } = require('@prediktgg/sdk/server');
console.log('cjs', typeof new PrediktSDK({ baseUrl: 'http://localhost', apiKey: 'k' }).accounts.register, typeof verifyAndSignApproval);
EOF
cat > use.ts <<'EOF'
import { PrediktSDK, TradingAccount, isReauthorizationPending } from '@prediktgg/sdk';
import { verifyAndSignApproval } from '@prediktgg/sdk/server';
export async function f(sdk: PrediktSDK, a: TradingAccount) {
  isReauthorizationPending(a);
  return verifyAndSignApproval(a, { ownerKey: '', privyAppId: '', privyAppSecret: '', expected: { privyWalletId: '', maxBuyAmountPerOrder: '1', expiresAt: '' } });
}
EOF
node esm.mjs && node cjs.cjs
for pair in "node10 commonjs" "node16 node16" "bundler esnext" "nodenext nodenext"; do
  set -- $pair   # in zsh use: set -- ${=pair}
  npx tsc --noEmit --strict --moduleResolution $1 --module $2 --target es2022 --types node use.ts && echo "tsc $1 ok"
done
```

Expected:

```
esm function function 2500000
cjs function function
tsc node10 ok
tsc node16 ok
tsc bundler ok
tsc nodenext ok
```

Also confirm the main entry stays browser-safe: `node:crypto` must only be reachable from
`@prediktgg/sdk/server`:

```bash
grep -rl "node:crypto" node_modules/@prediktgg/sdk/dist/esm   # only server.js and approval/verify-and-sign.js
```

---

## 4. Live end-to-end checklist

`scripts/e2e-checklist.mjs` runs the backend's end-to-end checklist (`SDK_INTEGRATION_GUIDE.md`
section 9) through the built SDK. Onboarding and read-only steps always run; approvals are free.
Steps that trade run **only** with `E2E_TRADE=1`.

### 4.1 One-time setup

| # | Who | What | Reference |
| --- | --- | --- | --- |
| 1 | Predikt admin | Create the integrator and a **backend** API key (`POST /admin/integrators`, `POST /admin/sdk-keys` with `"keyType": "backend"`) | backend `docs/DIRECT_TRADING_ONBOARDING_FLOW.md` steps 0–2 |
| 2 | Tester | In Privy: create an app (**App ID**, **App Secret**) and an **owner key** (dashboard → authorization keys). Keep the owner key's **private key** (`wallet-auth:...`) and its **key quorum ID** | flow step 3 |
| 3 | Tester → Predikt | Send the App Secret through the agreed private channel. Predikt runs `new-integrator-signer.ts <integratorId>`, sets the two env lines and restarts the backend | flow step 4 |
| 4 | Tester | Create a test wallet owned by the owner key (below) and note its **wallet ID** | flow step 6 |
| 5 | Predikt | Make sure the target environment runs a backend with the SDK-review changes (`docs/SDK_REVIEW_BACKEND_CHANGES.md`), including its two migrations (`npm run migration:run`; the baseline one is a no-op on an existing database); otherwise steps 3, 4 and 7b fail by design | |

Create the wallet with Privy's REST API (or in the Privy dashboard), with `owner_id` set to the
owner key quorum ID:

```bash
curl -s https://api.privy.io/v1/wallets \
  -u "$PRIVY_APP_ID:$PRIVY_APP_SECRET" \
  -H "privy-app-id: $PRIVY_APP_ID" -H 'Content-Type: application/json' \
  -d '{"chain_type":"ethereum","owner_id":"<owner key quorum ID>"}'
# → { "id": "<wallet ID>", "address": "0x...", "owner_id": "<owner key quorum ID>", ... }
```

### 4.2 Environment

The SDK itself reads no environment variables. Only this test script does, because it needs
secrets that should not be written into code. Copy the template and fill in the required values:

```bash
cp e2e.env.example e2e.env   # e2e.env is git-ignored: it holds secrets, never commit it
```

| Variable | Value |
| --- | --- |
| `PREDIKT_API_URL` | Predikt API base URL (develop: `https://prediktback.4pto.dev`) |
| `PREDIKT_API_KEY` | Backend API key of the test integrator (4.1 #1) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | The test integrator's Privy app (4.1 #2) |
| `PRIVY_OWNER_KEY` | Owner key's private key, `wallet-auth:...` or PEM (4.1 #2); used only to sign locally |
| `PRIVY_WALLET_ID` | The wallet from 4.1 #4 |
| `PRIVY_ENVIRONMENT` | `production` (default) or `development` |
| `E2E_MAX_BUY` | Grant cap, base units (default `2000000` = 2 pUSD) |
| `E2E_EXPIRES_AT` | Grant expiry (default `2027-12-31T00:00:00Z`); keep it fixed between runs |

Empty values count as unset.

Optional variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `E2E_TRADE` | unset | `1` runs the steps that trade |
| `E2E_COMBO_AMOUNT` | `1000000` | Combo budget (1 pUSD) |
| `E2E_COMBO_LEGS` | auto | `marketId:outcome,marketId:outcome`. Auto picks two unrelated markets priced 0.35–0.65 |
| `E2E_KEEP_COMBO` | unset | `1` skips the cash-out (step 8) and keeps the ticket, for the payout test (4.6) |
| `E2E_TOKEN_ID` | unset | Direct test: buy this outcome token, then sell `"all"` |
| `E2E_DIRECT_AMOUNT` | `2000000` | Direct buy budget (≤ `E2E_MAX_BUY`). Polymarket rejects buys under $1 and under ~5 shares. The backend reserves ~3% for fees first, so 1 pUSD is too small |
| `E2E_REDEEM_CONDITION_ID` | unset | Direct redeem of a resolved market the wallet holds |

Build once, then pass the file to Node with `--env-file` (Node 20.6+):

```bash
npm run build
node --env-file=e2e.env scripts/e2e-checklist.mjs
```

(Or export the variables in your shell, e.g. `set -a; source e2e.env; set +a`, and run
`node scripts/e2e-checklist.mjs`. Optional variables can also be given inline, as below.)

### 4.3 Run 1: onboarding, no funds

```bash
node --env-file=e2e.env scripts/e2e-checklist.mjs
```

Expected (IDs differ):

```
✓ 1 Connect Privy app — app <app id> active
✓ 2 Register wallet → verify + sign → activate — awaiting_owner_approval → active; account <uuid>, deposit wallet 0x...
✓ 3 Reauthorize with new limits → still trading while pending → active with new limits, then restore — pending shown with activeGrant 2; cap 3 pUSD activated, restored to 2
✓ 4 Privy policy contains the Exchange v3 (Combos) rule — policy <id>, 7 rules; activeGrant polymarket-privy-1271-broad-batch-v4, combosEnabled
✓ 5r Portfolio, redeemable and order change feed (read-only) — pUSD 0, 0 positions, 0 redeemable, feed ok (0 orders)
- 5 Direct buy / sell / redeem: skipped (set E2E_TRADE=1)
- 6 … - 8: skipped (set E2E_TRADE=1)
✓ 9 Combo buy with a wallet that is not yours → 403 COMBO_WALLET_NOT_ALLOWED — 403 COMBO_WALLET_NOT_ALLOWED
✓ 11/12 Combo payouts recorded so far (REDEEM orders, both sources) — POLYMARKET_AUTO 0, API 0 (...)
```

It ends with a summary table and exits with `1` if any step failed. Note the **deposit wallet**
address from step 2. Run 1 can be repeated at any time: it is idempotent and restores the grant's
limits.

### 4.4 Fund the Deposit Wallet

Send about **5 pUSD** (Polymarket's collateral token) on Polygon to the deposit wallet address
from step 2. Send pUSD, not USDC.e: USDC.e shows up as `balances.usdce` and cannot be traded. Fund
the deposit wallet, not the Privy wallet's own address. Re-run step 5r (run 1 again) and check that
`pUSD 5` appears.

### 4.5 Run 2: trading

Optionally pick a direct-trading token. Predikt's market API does not return Polymarket token IDs,
so find the market with `sdk.markets.list({ search, platforms: ['polymarket'] })`, take its
`platformMarketId` (the Gamma market ID; `ticker` is the slug), and read the outcome tokens from
Polymarket's Gamma API (`clobTokenIds`, in the order of `outcomes`; the first is "Yes"):

```bash
curl -s "https://gamma-api.polymarket.com/markets/<platformMarketId>" | jq -r '.outcomes, .clobTokenIds'
```

Prefer an open market with a deep book and a price of about 0.1–0.9, for example
"Will the U.S. invade Iran before 2027?" (`platformMarketId` 665374).

Then:

```bash
E2E_TRADE=1 E2E_TOKEN_ID=<token id> node --env-file=e2e.env scripts/e2e-checklist.mjs
```

Expected in addition to run 1 (amounts differ):

```
✓ 5 Direct buy / sell / redeem — bought 12.125 for 1.94, sold for 1.818
✓ 6 Combo quote + buy — indicative 0.25, max 0.2875, effective 0.27, 3.703703 shares, combo 0x..., tx 0x...
✓ 7 Combo buy again with the same clientOrderId → same order — same order <uuid>
✓ 7b Same clientOrderId with a different amount → 409 COMBO_CLIENT_ORDER_ID_REUSED from the API — 409 ...
✓ 10 Combo redeem before resolution → 409 COMBO_NOT_REDEEMABLE — 409 COMBO_NOT_REDEEMABLE
✓ 8 Combo sell (full cash-out) — sold 3.7 shares for 0.95 pUSD
```

Cost: spreads and fees on about 2 pUSD of round trips, typically a few cents. A full cash-out can
leave ~0.008 combo shares, and `"all"` can leave sub-cent dust.

What each step proves (guide section 9):

| Step | Guide # | Proves |
| --- | --- | --- |
| 1 | 1 | Privy app connected (`status: active`) |
| 2 | 2 | Register → `verifyAndSignApproval` (checks against Privy) → activate |
| 3 | 3, 3b | Re-authorization: while pending, `GET` shows `awaiting_owner_approval` with `activeGrant` = old limits (`isReauthorizationPending`); after activation the new cap applies; then restored |
| 4 | 4 | The Privy policy has the Exchange v3 rule, and the API reports `activeGrant.combosEnabled: true` |
| 5r | – | Portfolio, redeemable and change feed read |
| 5 | 5 | Direct buy and sell end `filled` (`waitForOrder`); redeem `redeemed`, or rejected with `REDEEMED_BY_POLYMARKET` |
| 6 | 6 | Combo quote and buy → `FILLED` with `txHash` |
| 7 | 7 | Same `clientOrderId` → same order, no new trade |
| 7b | 7b | Same `clientOrderId`, different amount → `409` **from the API**, no trade |
| 10 | 10 | Redeem before resolution → `409 COMBO_NOT_REDEEMABLE` |
| 8 | 8 | Full cash-out → `FILLED`, `amount` = proceeds |
| 9 | 9 | A wallet that is not yours → `403 COMBO_WALLET_NOT_ALLOWED` |
| 11/12 | 11, 12 | Counts recorded payouts (see 4.6) |

### 4.6 Payouts (guide 11 and 12)

These need a combo that resolves, so they take a day or more.

1. Find two unrelated combo markets that resolve within a day, for example near-term sports
   (`sdk.combos.listMarkets()`, or Polymarket). Buy a ticket and keep it:

   ```bash
   E2E_TRADE=1 E2E_KEEP_COMBO=1 E2E_COMBO_LEGS=<marketId>:0,<marketId>:0 node --env-file=e2e.env scripts/e2e-checklist.mjs
   ```

   Note the `combo 0x...` printed by step 6, the ticket's `comboConditionId`.
2. After every leg resolves and the combo wins, Polymarket's AutoRedeemer pays into the deposit
   wallet. Within ~10 minutes of that payout, run 1 again: step 11/12 must show
   `POLYMARKET_AUTO ≥ 1`. The order has `direction: REDEEM`, `status: FILLED`,
   `source: POLYMARKET_AUTO`, and `amount` = the payout. A losing ticket pays nothing, so pick legs
   you expect to win, or repeat with another ticket.
3. **Guide 12 (manual redeem):** on a winning combo that is redeemable but not yet paid out, save
   this as `redeem.mjs` in the SDK folder and run `node redeem.mjs <deposit wallet> <comboConditionId>`
   with `e2e.env` loaded:

   ```js
   import { PrediktSDK } from './dist/esm/index.js';

   const [wallet, comboConditionId] = process.argv.slice(2);
   const sdk = new PrediktSDK({ baseUrl: process.env.PREDIKT_API_URL, apiKey: process.env.PREDIKT_API_KEY });
   const order = await sdk.combos.redeem({ wallet, comboConditionId, clientOrderId: `manual-redeem-${Date.now()}` });
   console.log(await sdk.combos.waitForOrder(order));
   ```

   Expected: `FILLED` REDEEM (`amount` = payout), or `FAILED` with `COMBO_ALREADY_REDEEMED` if
   Polymarket paid first. In that case the `POLYMARKET_AUTO` order appears instead. Before
   resolution it fails with `409 COMBO_NOT_REDEEMABLE`.

### 4.7 If a step fails

The failing step prints the API error `code`. Common cases:

| Step | Message | Cause | Fix |
| --- | --- | --- | --- |
| 1 | `PRIVY_APP_SECRET_NOT_CONFIGURED` / `PRIVY_AUTHORIZATION_KEY_NOT_CONFIGURED` | Setup 4.1 #3 not done | Predikt configures the App Secret and signer, then restarts |
| 1 | `PRIVY_APP_ALREADY_CONNECTED` | Another Privy app is connected to this integrator | Use that app's credentials, or a new integrator |
| 2 | `PRIVY_SETUP_OWNER_REQUIRED` / `_UNSUPPORTED` | Wallet not owned by the owner key | Create the wallet with `owner_id` (4.1) |
| 2 | `TRADING_AUTHORIZATION_EXISTS` | The wallet already has a grant with other limits | Set `E2E_MAX_BUY` / `E2E_EXPIRES_AT` to the current ones |
| 2, 3 | `Refusing to sign: …` (`ApprovalVerificationError`) | The approval failed a security check | **Do not work around it.** Send the message to the backend team. `OWNER_KEY_INVALID`: wrong `PRIVY_OWNER_KEY`; `PRIVY_REQUEST_FAILED`: wrong Privy credentials; `APPROVAL_EXPIRED`: re-run |
| 2, 3 | `PRIVY_SETUP_REJECTED` | Privy rejected the signature | Wrong owner key for this wallet |
| 3 | `pending re-authorization not visible` | Backend without `activeGrant` | Deploy the backend changes |
| 4 | `activeGrant.combosEnabled is undefined` / `null` | Backend without the policy-profile change (or its migration not run) | Deploy the backend changes and run `npm run migration:run`; step 3 re-verifies the grant, which records the profile |
| 5 | `ORDER_TOO_SMALL` | Buy under 1 pUSD after the ~3% fee reserve (e.g. `E2E_DIRECT_AMOUNT=1000000`), or a sell under the ~5-share minimum | `E2E_DIRECT_AMOUNT` ≥ 1100000 (≤ `E2E_MAX_BUY`), or a cheaper token |
| 5 | `BUY_AUTHORIZATION_CAP_EXCEEDED` | `E2E_DIRECT_AMOUNT` above `E2E_MAX_BUY` | Lower it, or reauthorize with a higher cap |
| 5 | `buy rejected VENUE_REJECTED` | Polymarket refused the order for another reason. The exact message is only in the backend log (`… not executed: …`) | Ask the backend team for the log line |
| 5, 6 | `INSUFFICIENT_BALANCE` | Deposit wallet not funded | 4.4 |
| 5 | `buy rejected FOK_NOT_FILLED` | Not enough liquidity within slippage | Another token |
| 6 | `status FAILED NO_QUOTES` / `PRICE_ABOVE_MAX` | No market maker quoted, or quote above max | Re-run in a minute, or set other `E2E_COMBO_LEGS` (legs ~0.4–0.6, unrelated) |
| 6 | `status FAILED SIGNING_FAILED` | Grant on policy v3 (no Exchange v3) | Step 3 upgrades it; re-run |
| 6 | `429` | More than 15 RFQs per minute for the wallet | Wait a minute |
| 7b | `only the SDK fallback check caught it` | Backend without the 409 change | Deploy the backend changes |
| 8 | `SIZE_TOO_LARGE` / `INVALID_RFQ` | Maker rounding or a very small size | Re-run; see guide 7.6 |

`409 TRADING_APPROVALS_PENDING` (first trade of a new wallet) is retried automatically for about 45
seconds. If it still fails, re-run.

### 4.8 After testing

- Funds stay in the deposit wallet. Withdrawals are done by the wallet owner in Privy, not through
  the Predikt API.
- To revoke Predikt's access to the test wallet, remove Predikt's signer from the wallet in Privy.
- Keep `e2e.env` out of git and delete it when no longer needed.

---

## 5. Coverage of the guide's checklist

| Guide # | Test | Unit | Contract | Live (step) |
| --- | --- | --- | --- | --- |
| 1 | Connect Privy app | ✓ | ✓ | 1 |
| 2 | Register → sign → activate | ✓ | ✓ (real backend mappers) | 2 |
| 3 | Reauthorize | ✓ | ✓ | 3 |
| 3b | Pending re-authorization visible (`activeGrant`) | ✓ | ✓ | 3 |
| 4 | Exchange v3 rule in the policy | ✓ (policy shape check) | ✓ | 4 |
| 5 | Direct buy / sell / redeem | ✓ | ✓ | 5 |
| 6 | Combo quote + buy | ✓ | ✓ | 6 |
| 7 | Same `clientOrderId` → same order | ✓ | ✓ (real `ComboExecutionService`) | 7 |
| 7b | Reused `clientOrderId` → 409 | ✓ | ✓ (real `ComboExecutionService`) | 7b |
| 8 | Combo cash-out | ✓ | ✓ | 8 |
| 9 | Foreign wallet → 403 | – | ✓ | 9 |
| 10 | Redeem before resolution → 409 | – | ✓ | 10 |
| 11 | Automatic payout recorded | – | – | 4.6 |
| 12 | Manual redeem on a resolved combo | – | – | 4.6 |

Only the live run touches Privy, Polygon and Polymarket. Levels 1–3 do not prove anything about
Polymarket's market makers, Privy's policy engine or on-chain settlement.
