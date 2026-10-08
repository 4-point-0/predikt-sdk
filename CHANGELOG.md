# Changelog

All notable changes to this project will be documented in this file.

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
