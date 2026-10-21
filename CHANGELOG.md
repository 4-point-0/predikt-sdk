# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-10-19

### Added
- Direct trading on integrator-owned Privy wallets (server-side, backend API key):
  - `sdk.privyApp` — `connect`, `get`.
  - `sdk.accounts` — `register` (repeats the request while the Deposit Wallet is
    `provisioning`), `get`, `activate`, `reauthorize`, `portfolio`, `redeemable`.
  - `sdk.trading` — `buy`, `sell`, `redeem`, `withdraw` (pUSD to the account's own Privy
    wallet; `side: 'withdraw'`, status `withdrawn`), `getOrder`, `listOrderChanges`,
    `iterateOrderChanges` (cursor change feed), `waitForOrder`.
- Polymarket Combos: `sdk.combos` — `listMarkets`, `iterateMarkets`, `quote`, `buy`, `sell`,
  `redeem`, `getOrder`, `listOrders`, `iterateOrders`, `positions`, `activity`, `waitForOrder`.
  A `clientOrderId` reused for a different request is `409 COMBO_CLIENT_ORDER_ID_REUSED` (from the
  API; for older API versions the SDK raises it itself, with `details.raisedBy: 'sdk'`).
- `@prediktgg/sdk/server` entry (Node only): `verifyAndSignApproval` checks a Predikt owner
  approval against Privy (exact policy-profile-v4 rules, signer list, request expiry) and your
  expected limits, then signs it with the owner key;
  `ApprovalVerificationError`, `canonicalJson` (RFC 8785).
- Methods take a `TradingAccount` wherever an `accountId` or Deposit Wallet address is needed.
- `TradingAccount.activeGrant` (limits, `policyProfile`, `combosEnabled`) and
  `isReauthorizationPending(account)`: tell a pending re-authorization (still trading under
  `activeGrant`) from a first approval, and whether the account can trade combos.
- Automatic retries for the new, idempotent calls (network errors, timeouts, `5xx` with
  `details.retryable` and no recorded order, `409 TRADING_APPROVALS_PENDING`), configurable with
  `retry`; optional `timeoutMs` for all requests.
- Errors carry `details` (`orderId`, `retryable` getters) and a `statusCode` alias;
  `PrediktServiceUnavailableError` (503).
- Helpers: `toBaseUnits`, `fromBaseUnits`, `isDirectOrderFinal`, `isComboOrderFinal`.
- Unit tests (`npm test`), contract tests against the backend code (`npm run test:contract`),
  and `scripts/e2e-checklist.mjs` for a live end-to-end check.
- `INTEGRATION_GUIDE.md` (shipped in the package): step-by-step guide for integrating Polymarket
  Combos and direct trading on Privy wallets.

### Fixed
- `orders.listBuyOrders`, `listSellOrders` and `listRedeemOrders` are now typed as the API's
  `{ items, total }` envelope (`OrdersListResponse<T>`); they were typed as plain arrays.

### Changed
- `baseUrl` with a path prefix (e.g. `https://host/api`) is now kept for GET requests too, and a
  trailing slash no longer produces `//` in request paths.

## [0.1.2] - 2026-10-08

### Fixed
- ESM entry point now loads under Node's ES module resolver. Relative imports in
  the published output carry explicit `.js` extensions, and `dist/esm` / `dist/cjs`
  ship `package.json` type markers, so `import '@prediktgg/sdk'` no longer fails
  with `ERR_MODULE_NOT_FOUND`. Previously only bundler-based consumers (Vite,
  webpack, Next) could load the ESM build; plain Node ESM was broken.
- `types` now precedes `import` / `require` in the `exports` map, so TypeScript
  resolves declarations correctly under `node16`, `nodenext` and `bundler`
  module resolution.

## [0.1.1] - 2026-09-10

### Added
- Event-group fields on markets and positions (`eventKey`, `eventTitle`, `outcomeLabel`, `yesLabel`, `noLabel`), plus `metadata`, `createdAt`, `updatedAt` on markets.
- `feeBps` on the buy-simulate response (integrator fee rate in basis points).
- `PrediktRateLimitError` (HTTP 429) with `retryAfter` seconds parsed from the `Retry-After` header.
- `sdk.venues.getStatus()` — public venue trading status.

## [0.1.0] - 2026-07-08

### Added
- Initial release of the Predikt SDK.
- API key and JWT authentication.
- Custom error types.
- `getMarket` and `getPriceHistory` endpoints.
