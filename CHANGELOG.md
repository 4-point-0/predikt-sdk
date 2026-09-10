# Changelog

All notable changes to this project will be documented in this file.

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
