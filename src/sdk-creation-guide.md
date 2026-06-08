# Predikt SDK Creation Guide

This guide covers everything needed to create, publish, and maintain the Predikt TypeScript SDK — from the relationship between the two repos, through packaging and build setup, to versioning, CI/CD, and the processes that keep the SDK accurate over time.

---

## Table of Contents

1. [What the SDK Is and What It Covers](#1-what-the-sdk-is-and-what-it-covers)
2. [How the Two Repos Relate](#2-how-the-two-repos-relate)
3. [File and Folder Structure Connection](#3-file-and-folder-structure-connection)
4. [Repository and Package Setup](#4-repository-and-package-setup)
5. [TypeScript Config Files](#5-typescript-config-files)
6. [Authentication: API Keys + JWT](#6-authentication-api-keys--jwt)
7. [Backend: SDK Module](#7-backend-sdk-module)
8. [Extracting Shared Types](#8-extracting-shared-types)
9. [HTTP Client Architecture](#9-http-client-architecture)
10. [Resource Clients and Endpoints](#10-resource-clients-and-endpoints)
11. [WebSocket Client](#11-websocket-client)
12. [Error Handling](#12-error-handling)
13. [Testing Strategy](#13-testing-strategy)
14. [Versioning](#14-versioning)
15. [CHANGELOG.md](#15-changelogmd)
16. [Publishing to npm and CI/CD](#16-publishing-to-npm-and-cicd)
17. [Keeping the SDK Up to Date](#17-keeping-the-sdk-up-to-date)
18. [Long-Term: OpenAPI-Driven Generation](#18-long-term-openapi-driven-generation)
19. [Implementation Roadmap](#19-implementation-roadmap)

---

## 1. What the SDK Is and What It Covers

There are two separate things:

**Predikt Aggregator** (`predikt-aggregator/`) — the NestJS backend you already have. It runs on a server, owns the database, talks to Kalshi and Polymarket, and executes orders. This is what integrators want to access.

**SDK** (`predikt-sdk/`, a new separate repo) — a TypeScript npm package that integrators install in *their* projects. It has zero NestJS, zero database. It is a typed HTTP client that calls the aggregator's REST API over the network.

At runtime the two pieces communicate only over HTTP. There is no code import between them.

The SDK is a typed wrapper over the Predikt Aggregator REST API and WebSocket feed. Its job is to:

- Identify the calling application via an **API key** (`x-api-key` header).
- Authenticate end-users via the existing wallet-signature JWT flow.
- Shield consumers from raw HTTP calls and manual JSON parsing.
- Re-export the same TypeScript types the backend already defines so integrators get accurate IDE autocomplete.
- Provide a typed WebSocket client for live price updates.

**In scope:**

| Group | Routes |
|-------|--------|
| Auth | `POST /sdk/v1/auth/challenge`, `POST /sdk/v1/auth/verify` |
| Markets | `GET /sdk/v1/markets`, `GET /sdk/v1/markets/:id`, `GET /sdk/v1/markets/:id/details`, `GET /sdk/v1/markets/:id/matched-group` |
| Matched Markets | `GET /sdk/v1/matched-markets/:id` |
| Price History | `GET /sdk/v1/price-history/market/:id`, `GET /sdk/v1/price-history/matched-market/:id`, `GET /sdk/v1/price-history/:id` |
| Positions | `GET /sdk/v1/positions`, `GET /sdk/v1/positions/:id` |
| Orders | `GET /sdk/v1/orders/buy`, `GET /sdk/v1/orders/buy/:id`, `GET /sdk/v1/orders/sell`, `GET /sdk/v1/orders/sell/:id`, `GET /sdk/v1/orders/redeem`, `GET /sdk/v1/orders/redeem/:id` |
| Buy | `POST /sdk/v1/buy/simulate`, `POST /sdk/v1/buy`, `POST /sdk/v1/buy/:id/tx-hash`, `POST /sdk/v1/buy/batch`, `POST /sdk/v1/buy/batch/:batchId/tx-hashes` |
| Sell | `POST /sdk/v1/sell/simulate`, `POST /sdk/v1/sell`, `POST /sdk/v1/sell/:id/solana-tx`, `POST /sdk/v1/sell/batch`, `POST /sdk/v1/sell/batch/:batchId/chain-tx` |
| Redeem | `POST /sdk/v1/redeem`, `POST /sdk/v1/redeem/:id/solana-tx` |
| WebSocket | `wss://<host>/ws/markets` |

**Out of scope (admin/internal):**
- `/admin/*` — not intended for third-party consumption
- `/embeddings/*` — internal pipeline tooling
- `/share/*` — platform-specific feature; expose only if needed later
- `/metrics/*` — optional monitoring; add in a later SDK version if needed

---

## 2. How the Two Repos Relate

```
┌─────────────────────────────────────┐
│         predikt-aggregator          │
│  (NestJS, Postgres, deployed server) │
│                                     │
│   /sdk/v1/markets  ──────────────┐  │
│   /sdk/v1/buy      ──────────┐   │  │
│   /ws/markets      ──────┐   │   │  │
└──────────────────────────│───│───│──┘
                           │   │   │   HTTP / WebSocket over the network
┌──────────────────────────│───│───│──┐
│    predikt-sdk (npm package)        │
│                                     │
│   PrediktWebSocket ──────┘   │   │  │
│   BuyResource      ──────────┘   │  │
│   MarketsResource  ──────────────┘  │
└─────────────────────────────────────┘
                    ↓
           installed via npm
┌─────────────────────────────────────┐
│     integrator's project            │
│  import { PrediktClient } from      │
│    '@predikt/sdk'                   │
└─────────────────────────────────────┘
```

The SDK repo has **no npm dependency on** the aggregator repo. There is no `require()` or `import` between the two at any level. The connection is purely:

1. **Types** — enums and interfaces are manually copied (or script-synced) from `src/core/domain/types/` in the aggregator into `src/types/` in the SDK. They live in both repos as duplicated TypeScript. The risk is drift — the backend changes a DTO and the SDK doesn't know. Long-term, OpenAPI generation eliminates this (see §18).

2. **Routes** — the SDK hardcodes the URL paths (`/sdk/v1/markets`, etc.). If the backend renames or removes a route, the SDK needs a new release.

3. **API key** — the aggregator config has `SDK_API_KEY=sk_predikt_...`. The integrator puts the same string in their app. No file is shared; it is just a string that must match.

---

## 3. File and Folder Structure Connection

There are exactly three points of structural connection between the two repos.

### Point 1 — Backend SDK module ↔ SDK resource clients

The aggregator gets a new module `src/modules/sdk/` that exposes routes under `/sdk/v1/`. These are the routes the SDK calls.

```
predikt-aggregator/
└── src/modules/sdk/
    ├── guards/api-key.guard.ts        →  enforces x-api-key header
    ├── controllers/
    │   ├── sdk-markets.controller.ts  →  GET  /sdk/v1/markets
    │   ├── sdk-buy.controller.ts      →  POST /sdk/v1/buy
    │   ├── sdk-auth.controller.ts     →  POST /sdk/v1/auth/challenge
    │   └── ...
    └── sdk.module.ts

        ↕  HTTP over the network

predikt-sdk/
└── src/resources/
    ├── markets.ts    →  calls GET  /sdk/v1/markets
    ├── buy.ts        →  calls POST /sdk/v1/buy
    ├── auth.ts       →  calls POST /sdk/v1/auth/challenge
    └── ...
```

Each controller file on the left has a corresponding resource file on the right. The controller defines what the server accepts; the resource defines what the client sends.

### Point 2 — Backend core types ↔ SDK types

The enums and domain constants the SDK exposes to integrators are copied from the aggregator's core module:

```
predikt-aggregator/
└── src/core/domain/types/
    ├── market.types.ts    →  PlatformType, MarketStatus, MarketCategory ...
    └── chain.types.ts     →  WalletChain, Outcome, BuyOrderStatus ...

        ↕  manual copy / sync script (no npm link)

predikt-sdk/
└── src/types/
    ├── enums.ts           →  same enums, NestJS decorators stripped
    ├── market.types.ts    →  interfaces matching backend DTOs
    ├── order.types.ts
    └── ...
```

No code import — they are duplicated. If the aggregator changes an enum value, you update the SDK types and cut a new version.

### Point 3 — API key config ↔ SDK client option

```
predikt-aggregator/
└── src/config/sdk.config.ts
    SDK_API_KEY=sk_predikt_d4f8a2e6b1c9...   (env var on the server)

        ↕  same string, given to the integrator out-of-band

predikt-sdk/
└── src/client.ts
    new PrediktClient({ apiKey: 'sk_predikt_d4f8a2e6b1c9...' })
```

Not a file connection — just a string that has to match.

### What has no connection

Everything else in the aggregator is invisible to the SDK: the database, TypeORM entities, NestJS decorators, the matching pipeline, embeddings, bridge logic, and the existing `/markets`, `/buy`, `/auth` routes (non-SDK). The SDK only calls `/sdk/v1/*`.

---

## 4. Repository and Package Setup

### Option A: Separate package (recommended)

Create a new git repository `predikt-sdk`. This keeps the SDK versioned independently and avoids pulling NestJS into consumer projects.

```
predikt-sdk/
├── src/
│   ├── index.ts               # re-exports everything public
│   ├── client.ts              # PrediktClient
│   ├── http.ts                # HttpClient (API key + JWT injection)
│   ├── errors.ts              # PrediktError
│   ├── types/
│   │   ├── enums.ts
│   │   ├── market.types.ts
│   │   ├── order.types.ts
│   │   ├── position.types.ts
│   │   ├── price-history.types.ts
│   │   ├── ws.types.ts
│   │   └── index.ts
│   ├── resources/
│   │   ├── auth.ts
│   │   ├── markets.ts
│   │   ├── matched-markets.ts
│   │   ├── price-history.ts
│   │   ├── positions.ts
│   │   ├── orders.ts
│   │   ├── buy.ts
│   │   ├── sell.ts
│   │   └── redeem.ts
│   └── ws/
│       └── predikt-websocket.ts
├── tests/
│   ├── markets.test.ts
│   ├── buy.test.ts
│   └── ...
├── scripts/
│   └── sync-types.ts          # copies enums from aggregator
├── .github/workflows/
│   └── publish.yml            # auto-publish on git tag
├── package.json
├── tsconfig.json              # base config (never run directly)
├── tsconfig.build.json        # ESM output
├── tsconfig.cjs.json          # CommonJS output
└── CHANGELOG.md
```

### Option B: Monorepo package inside this repo

Add a `packages/sdk/` workspace. Useful for keeping types in sync with the backend at the cost of coupling releases.

```json
// root package.json
{
  "workspaces": ["packages/*"]
}
```

**Recommendation:** Start with Option A. A clear SDK release cadence is easier when the SDK is not tied to backend deployments.

### `package.json` explained field by field

```json
{
  "name": "@predikt/sdk",
  "version": "0.1.0",
  "description": "Official TypeScript SDK for the Predikt prediction-market aggregator",
  "main":   "dist/cjs/index.js",
  "module": "dist/esm/index.js",
  "types":  "dist/types/index.d.ts",
  "exports": {
    ".": {
      "import":  "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "types":   "./dist/types/index.d.ts"
    }
  },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && tsc -p tsconfig.cjs.json",
    "test":  "vitest",
    "lint":  "eslint src --ext .ts"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest":     "^1.0.0"
  }
}
```

**`name: "@predikt/sdk"`** — scoped package. The `@predikt` scope means it lives at `npmjs.com/package/@predikt/sdk`. Integrators install it with `npm install @predikt/sdk`.

**`version: "0.1.0"`** — follows semver. You never edit this by hand; use `npm version patch/minor/major`. That command updates this field and creates a git tag automatically.

**`main`, `module`, `types`** — three different entry points for three different consumers:
- `main` → Node.js plain `require('@predikt/sdk')`
- `module` → bundlers like Vite and webpack (tree-shakeable ES modules)
- `types` → TypeScript type-checker

All three point into `dist/` which does not exist in git — it is produced by `npm run build`.

**`exports`** — the modern equivalent of `main`/`module`, takes precedence in Node 12+. Allows exposing sub-paths in the future (`@predikt/sdk/ws`, etc.) without breaking the root import.

**`files: ["dist"]`** — the most important field for a library. When you run `npm publish`, npm only uploads what is listed here. Source files, tests, and config stay off npm. What integrators download is only `dist/`.

**`devDependencies` only, no `dependencies`** — the SDK has no runtime dependencies. `typescript` and `vitest` are build and test tools only you need; integrators don't. This is intentional — using native `fetch` means nothing gets added to the integrator's bundle.

---

## 5. TypeScript Config Files

Every `tsconfig.json` is a set of instructions to the TypeScript compiler (`tsc`). The SDK needs multiple because it compiles the same source code into different output formats.

### `tsconfig.json` — the base, never run directly

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "declaration": true,
    "sourceMap": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
```

This holds shared options the other two configs inherit via `"extends"`. `strict: true` enables all type-safety checks. `declaration: true` tells tsc to emit `.d.ts` declaration files alongside every `.js` file. `rootDir: src` means all input comes from `src/`.

### `tsconfig.build.json` — ESM output

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist/esm",
    "declarationDir": "dist/types"
  },
  "exclude": ["tests"]
}
```

`module: ESNext` produces JS with `import`/`export` statements — the format Vite, webpack, and modern bundlers consume. `declarationDir: dist/types` collects all `.d.ts` files into one place instead of scattering them through `dist/esm/`.

### `tsconfig.cjs.json` — CommonJS output

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "outDir": "dist/cjs",
    "declaration": false
  },
  "exclude": ["tests"]
}
```

`module: CommonJS` produces JS with `require()`/`module.exports` — the format plain Node.js uses. `declaration: false` because `.d.ts` files were already emitted by the ESM build; no need to emit them twice.

### How the three work together

The build script runs them in sequence:

```bash
tsc -p tsconfig.build.json   # → dist/esm/ + dist/types/
tsc -p tsconfig.cjs.json     # → dist/cjs/
```

After build, `dist/` looks like:

```
dist/
├── esm/
│   ├── index.js
│   ├── client.js
│   ├── resources/markets.js
│   └── ...
├── cjs/
│   ├── index.js
│   ├── client.js
│   └── ...
└── types/
    ├── index.d.ts
    ├── client.d.ts
    └── ...
```

Same source, two compiled outputs, one set of type declarations. An integrator using Vite gets `dist/esm/`, an integrator using plain Node gets `dist/cjs/`, both get types from `dist/types/`.

---

## 6. Authentication: API Keys + JWT

The SDK uses two-layer authentication:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Application | `x-api-key` header | Identifies the integrating application |
| User | `Authorization: Bearer <jwt>` | Identifies the end-user; required only for user-specific operations |

### Layer 1 — API Key (every request)

Every request from the SDK must include:

```
x-api-key: <your-api-key>
```

The API key identifies the integrating application for rate-limiting, analytics, and access control. The SDK client stores it once at construction and injects it on every request automatically.

**Initial setup (hardcoded key):** For the first integration, a single static API key is issued. Key management (rotation, scoping, per-integrator keys) is a future concern. For now, a single key shared with the integrator suffices.

Example key format: `sk_predikt_d4f8a2e6b1c9f3a7e5d2b8f4c6a9e1d3`

### Layer 2 — User JWT (user-specific operations only)

Operations that act on behalf of a user (buy, sell, redeem, view orders, view positions) additionally require a JWT obtained via the wallet-signature challenge/verify flow:

1. `POST /sdk/v1/auth/challenge` → receive a nonce and message to sign
2. User signs the message off-chain with their wallet
3. `POST /sdk/v1/auth/verify` → exchange signed message for `{ access_token }`
4. Include `Authorization: Bearer <access_token>` on subsequent user requests

The SDK client stores the JWT in memory and injects it automatically once set via `client.setToken(token)`.

### Which endpoints require which auth

| Endpoint group | API key | JWT |
|---------------|---------|-----|
| `auth/challenge`, `auth/verify` | Required | Not required |
| `markets/*`, `matched-markets/*`, `price-history/*` | Required | Not required |
| `positions/*`, `orders/*` | Required | Required |
| `buy/*`, `sell/*`, `redeem/*` | Required | Required |

---

## 7. Backend: SDK Module

The backend exposes SDK routes under a dedicated prefix `/sdk/v1/` so they are versioned independently of the main API and uniformly gated by the `ApiKeyGuard`.

### `ApiKeyGuard`

```typescript
// src/modules/sdk/guards/api-key.guard.ts
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.configService.get<string>('sdk.apiKey');
    const provided = context.switchToHttp().getRequest<Request>().headers['x-api-key'];

    if (!provided || provided !== configured) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
```

The key is stored in `src/config/sdk.config.ts`, loaded from env var `SDK_API_KEY` with a static fallback for local development.

### `SdkModule`

```typescript
// src/modules/sdk/sdk.module.ts
@Module({
  imports: [
    AuthModule,
    MarketsModule,
    ExecutionModule,
    OrdersModule,
    PositionsModule,
    PriceHistoryModule,
  ],
  controllers: [
    SdkAuthController,
    SdkMarketsController,
    SdkMatchedMarketsController,
    SdkPriceHistoryController,
    SdkBuyController,
    SdkSellController,
    SdkRedeemController,
    SdkOrdersController,
    SdkPositionsController,
  ],
  providers: [ApiKeyGuard],
})
export class SdkModule {}
```

### Controller guard pattern

All SDK controllers apply `ApiKeyGuard` at the class level. User-authenticated methods additionally apply `JwtAuthGuard` at the method level. NestJS stacks guards — class-level runs first:

```typescript
@UseGuards(ApiKeyGuard)          // class-level: every method requires API key
@Controller('sdk/v1/buy')
export class SdkBuyController {

  @Post('simulate')              // API key only — no JWT needed
  simulate(@Body() dto: SimulateBuyRequestDto) { ... }

  @UseGuards(JwtAuthGuard)       // method-level: additionally requires JWT
  @Post()
  createBuyOrder(@Req() req: Request, @Body() dto: BuyOrderBodyDto) { ... }
}
```

### Required module export changes

For `SdkModule` to inject services from the existing modules, the following need to be added to their module's `exports` array:

| Module | Services to add to exports |
|--------|---------------------------|
| `AuthModule` | `AuthService` |
| `ExecutionModule` | `BuyService`, `SellService`, `RedeemService` |
| `OrdersModule` | `OrdersService` |
| `PriceHistoryModule` | `PriceHistoryService` |
| `MarketsModule` | Already exports `MarketsService`, `MatchedMarketService` ✓ |
| `PositionsModule` | Already exports `PositionsService` ✓ |

---

## 8. Extracting Shared Types

All enums and domain constants live in `src/core/domain/types/` and are exported via `src/core/index.ts`. Copy — or sync via a build script — only those needed by the public SDK surface.

### Enums to extract

**From `src/core/domain/types/market.types.ts`:**
```typescript
export enum PlatformType {
  POLYMARKET = 'polymarket',
  KALSHI = 'kalshi',
  LIMITLESS = 'limitless',
}

export enum MarketCategory {
  SPORTS = 'sports',
  POLITICS = 'politics',
  CRYPTO = 'crypto',
  ECONOMICS = 'economics',
  TECH_SCIENCE = 'tech_science',
  OTHER = 'other',
}

export enum MarketStatus {
  UNOPENED = 'unopened',
  OPEN = 'open',
  PAUSED = 'paused',
  CLOSED = 'closed',
  DETERMINED = 'determined',
  SETTLED = 'settled',
}

export enum MarketMatchType { EXACT = 'exact', RELATED = 'related' }
export enum OrderSide { BUY = 'buy', SELL = 'sell' }
```

**From `src/core/domain/types/chain.types.ts`:**
```typescript
export enum WalletChain { SOLANA = 'solana', SUI = 'sui' }
export enum Outcome { YES = 0, NO = 1 }
export enum SourceChain { SOLANA = '1', SUI = '21' }

export enum BuyOrderStatus {
  PENDING = 'pending', EXECUTING = 'executing',
  SETTLED = 'settled', FAILED = 'failed',
}
export enum SellOrderStatus {
  PENDING = 'pending', EXECUTING = 'executing', SOLD = 'sold',
  BRIDGING = 'bridging', SETTLED = 'settled', FAILED = 'failed',
}
export enum RedeemOrderStatus {
  PENDING = 'pending', EXECUTING = 'executing',
  BRIDGING = 'bridging', SETTLED = 'settled', FAILED = 'failed',
}
export enum BatchOrderStatus {
  PENDING = 'pending', EXECUTING = 'executing',
  SETTLED = 'settled', PARTIAL = 'partial', FAILED = 'failed',
}
export enum PositionStatus { OPEN = 'open', CLOSED = 'closed' }
```

### Interfaces to define in the SDK

**`src/types/market.types.ts`**
```typescript
export interface MarketDto {
  id: string;
  platform: PlatformType;
  platformMarketId: string;
  ticker: string;
  title: string;
  rules: string;
  status: MarketStatus;
  category: MarketCategory;
  startDate: string | null;
  endDate: string | null;
  yesAsk: number;
  yesBid: number;
  noAsk: number;
  noBid: number;
  volume: number;
  liquidity: number;
  imageUrl: string | null;
}

export interface MarketGroupDto {
  id: string;
  isGroupOfMultipleMarkets: boolean;
  title: string;
  description: string;
  category: MarketCategory;
  totalVolume: string;
  totalLiquidity: string;
  markets: MarketDto[];
  isFavourite?: boolean;
}

export interface MarketGroupDetailsDto extends MarketGroupDto {
  bestOdds: {
    marketBestOddsForYes: string | null;
    marketBestOddsForNo: string | null;
  };
}

export interface MarketDetailsResponse {
  marketDetails: MarketDto;
  matchGroup?: {
    id: string;
    title: string;
    description: string;
    category: MarketCategory;
    totalVolume: string;
    totalLiquidity: string;
    matchings: MarketDto[];
  };
  bestOdds: {
    marketBestOddsForYes: string | null;
    marketBestOddsForNo: string | null;
  };
}

export interface MatchedMarketDto {
  id: string;
  title: string;
  description: string;
  category: MarketCategory;
  createdAt: string;
  updatedAt: string;
  markets: MarketDto[];
}

export interface PaginatedResponse<T> {
  page: number;
  limit: number;
  total: number;
  data: T;
}
```

**`src/types/order.types.ts`**
```typescript
export interface BuyOrderDto {
  id: string;
  sourceChain: SourceChain;
  userSourceAddr: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  usdcAmount: string;
  maxPrice: string | null;
  bridgeAmount: string | null;
  bridgeTxHash: string | null;
  status: BuyOrderStatus;
  externalOrder: string | null;
  filledAmount: string | null;
  settlementTxHash: string | null;
  onChainConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuyOrderResponse {
  order: BuyOrderDto;
  transaction: { bytes: string };
  quote: {
    expectedOutput: string;
    bridgeFee: string;
    estimatedTime: number;
  };
}

export interface SellOrderDto {
  id: string;
  sourceChain: SourceChain;
  userSourceAddr: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  positionId: string | null;
  positionAmount: string;
  minPrice: string | null;
  isPartial: boolean;
  status: SellOrderStatus;
  onChainOrderId: string | null;
  onChainTxHash: string | null;
  externalOrder: string | null;
  usdcReceived: string | null;
  bridgeTxHash: string | null;
  settlementTxHash: string | null;
  onChainConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSellOrderResponse {
  order: SellOrderDto;
  transaction: { bytes: string };
}

export interface RedeemOrderDto {
  id: string;
  sourceChain: SourceChain;
  userSourceAddr: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  positionAmount: string | null;
  status: RedeemOrderStatus;
  onChainTxHash: string | null;
  usdcReceived: string | null;
  bridgeTxHash: string | null;
  settlementTxHash: string | null;
  marketRedemptionId: string | null;
  onChainConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRedeemOrderResponse {
  order: RedeemOrderDto;
  transaction: { bytes: string };
}

export interface SimulatedFill {
  price: string;
  size: string;
  cost: string;
}

export interface SimulateOrderResponse {
  fullyFillable: boolean;
  totalCost: string;
  totalContracts: string;
  averagePrice: string;
  bestPrice: string | null;
  levelsConsumed: number;
  worstPrice: string | null;
  fills: SimulatedFill[];
}

export interface SimulateAllResponse {
  polymarket?: SimulateOrderResponse;
  kalshi?: SimulateOrderResponse;
  limitless?: SimulateOrderResponse;
  bestPlatform?: PlatformType;
}
```

**`src/types/position.types.ts`**
```typescript
export interface PositionMarketDto {
  title: string;
  rules: string;
  category: MarketCategory;
  status: MarketStatus;
  winningOutcome: Outcome | null;
  volume: number;
  liquidity: number;
  startDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
}

export interface PositionDto {
  id: string;
  marketId: string | null;
  userAddress: string;
  ticker: string;
  source: PlatformType;
  outcome: Outcome;
  shares: number;
  averageCost: number;
  totalCost: number;
  value: number | null;
  pnl: number | null;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
  isWinner: boolean | null;
  market: PositionMarketDto | null;
}
```

**`src/types/price-history.types.ts`**
```typescript
export interface PricePoint {
  t: number;   // unix timestamp (seconds)
  p: number;   // price in cents 0–100
}

export interface PriceHistoryResponse {
  yes: PricePoint[];
  no: PricePoint[];
}

export interface MarketPriceHistory {
  marketId: string;
  platform: string;
  title: string;
  yes: PricePoint[];
  no: PricePoint[];
}

export interface MatchedMarketPriceHistoryResponse {
  matchedMarketId: string;
  markets: MarketPriceHistory[];
  errors: { marketId: string; error: string }[];
}
```

---

## 9. HTTP Client Architecture

All resource clients share a single `HttpClient` base class. This is the only place where the API key header, JWT injection, base URL, and error normalization live.

```typescript
// src/http.ts
import { PrediktError } from './errors';

export class HttpClient {
  constructor(private readonly opts: {
    baseUrl: string;
    apiKey: string;
    getToken: () => string | undefined;
    fetch?: typeof globalThis.fetch;
  }) {}

  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = new URL(this.opts.baseUrl + path);

    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          value.forEach(v => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.opts.apiKey,
    };

    const token = this.opts.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const fetchFn = this.opts.fetch ?? globalThis.fetch;
    const response = await fetchFn(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let json: unknown;
      try { json = JSON.parse(text); } catch { json = { message: text }; }
      throw new PrediktError(response.status, json);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
```

```typescript
// src/client.ts
export interface PrediktClientOptions {
  baseUrl: string;
  apiKey: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export class PrediktClient {
  private token: string | undefined;

  readonly auth: AuthResource;
  readonly markets: MarketsResource;
  readonly matchedMarkets: MatchedMarketsResource;
  readonly priceHistory: PriceHistoryResource;
  readonly positions: PositionsResource;
  readonly orders: OrdersResource;
  readonly buy: BuyResource;
  readonly sell: SellResource;
  readonly redeem: RedeemResource;
  readonly ws: PrediktWebSocket;

  constructor(options: PrediktClientOptions) {
    this.token = options.token;

    const http = new HttpClient({
      baseUrl: options.baseUrl.replace(/\/$/, ''),
      apiKey: options.apiKey,
      getToken: () => this.token,
      fetch: options.fetch,
    });

    this.auth           = new AuthResource(http);
    this.markets        = new MarketsResource(http);
    this.matchedMarkets = new MatchedMarketsResource(http);
    this.priceHistory   = new PriceHistoryResource(http);
    this.positions      = new PositionsResource(http);
    this.orders         = new OrdersResource(http);
    this.buy            = new BuyResource(http);
    this.sell           = new SellResource(http);
    this.redeem         = new RedeemResource(http);
    this.ws             = new PrediktWebSocket(
      options.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/markets',
    );
  }

  setToken(token: string)  { this.token = token; }
  clearToken()             { this.token = undefined; }
}
```

---

## 10. Resource Clients and Endpoints

All paths include the `/sdk/v1/` prefix. Each resource class receives the shared `HttpClient` and exposes typed methods.

### `AuthResource`

```typescript
export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  /** Step 1: obtain a nonce + message to sign with the user's wallet */
  challenge(params: ChallengeParams): Promise<ChallengeResponse> {
    return this.http.post('/sdk/v1/auth/challenge', params);
  }

  /** Step 2: exchange a signed message for a JWT */
  verify(params: VerifyParams): Promise<VerifyResponse> {
    return this.http.post('/sdk/v1/auth/verify', params);
  }
}
```

Auth convenience helper for integrators:

```typescript
export async function loginWithSolana(
  client: PrediktClient,
  walletAddress: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const { message, nonce } = await client.auth.challenge({ walletAddress, chain: WalletChain.SOLANA });
  const encoded = new TextEncoder().encode(message);
  const signatureBytes = await signMessage(encoded);
  const signature = Buffer.from(signatureBytes).toString('base64');
  const { access_token } = await client.auth.verify({ walletAddress, chain: WalletChain.SOLANA, nonce, signature });
  client.setToken(access_token);
  return access_token;
}
```

### `MarketsResource`

```typescript
export class MarketsResource {
  list(params?: MarketsListParams): Promise<PaginatedResponse<{ markets: MarketGroupDto[] }>>
  get(id: string): Promise<MarketDetailsResponse>
  getDetails(id: string, wallet?: string): Promise<MarketGroupDetailsDto>
  getMatchedGroup(marketId: string): Promise<MarketGroupDetailsDto>
}
```

### `MatchedMarketsResource`

```typescript
export class MatchedMarketsResource {
  get(id: string): Promise<MatchedMarketDto>
}
```

### `PriceHistoryResource`

```typescript
export class PriceHistoryResource {
  forMarket(marketId: string, params: PriceHistoryParams): Promise<PriceHistoryResponse>
  forMatchedMarket(matchedMarketId: string, params: PriceHistoryParams): Promise<MatchedMarketPriceHistoryResponse>
  get(id: string, params: PriceHistoryParams): Promise<MatchedMarketPriceHistoryResponse>
}
```

### `PositionsResource` *(requires JWT)*

```typescript
export class PositionsResource {
  list(params: PositionsListParams): Promise<PaginatedResponse<{ positions: PositionDto[] }>>
  get(id: string): Promise<PositionDto>
}
```

### `OrdersResource` *(requires JWT)*

```typescript
export class OrdersResource {
  getBuyOrders(params?: OrdersListParams): Promise<BuyOrderDto[]>
  getBuyOrder(id: string): Promise<BuyOrderDto>
  getSellOrders(params?: OrdersListParams): Promise<SellOrderDto[]>
  getSellOrder(id: string): Promise<SellOrderDto>
  getRedeemOrders(params?: OrdersListParams): Promise<RedeemOrderDto[]>
  getRedeemOrder(id: string): Promise<RedeemOrderDto>
}
```

### `BuyResource` *(simulate: API key only; all others: requires JWT)*

```typescript
export class BuyResource {
  /** Simulate across all platforms without placing an order */
  simulate(params: SimulateBuyParams): Promise<SimulateAllResponse>

  /** Returns base64 transaction.bytes for the user to sign and broadcast */
  create(params: BuyOrderParams): Promise<CreateBuyOrderResponse>

  submitBridgeTxHash(orderId: string, bridgeTxHash: string): Promise<BuyOrderDto>
  createBatch(items: BuyOrderParams[]): Promise<{ batchId: string; orders: BuyOrderDto[]; transaction: { bytes: string } }>
  submitBatchTxHashes(batchId: string, hashes: { groupId: string; txHash: string }[]): Promise<void>
}
```

### `SellResource` *(simulate: API key only; all others: requires JWT)*

```typescript
export class SellResource {
  simulate(params: SimulateSellParams): Promise<SimulateAllResponse>
  create(params: SellOrderParams): Promise<CreateSellOrderResponse>
  linkSolanaTx(orderId: string, txSignature: string): Promise<SellOrderDto>
  createBatch(items: SellOrderParams[]): Promise<{ batchId: string; orders: SellOrderDto[]; transaction: { bytes: string } }>
  linkBatchChainTx(batchId: string, txSignature: string): Promise<void>
}
```

### `RedeemResource` *(requires JWT)*

```typescript
export class RedeemResource {
  create(params: RedeemOrderParams): Promise<CreateRedeemOrderResponse>
  linkSolanaTx(orderId: string, txSignature: string): Promise<{ order: RedeemOrderDto }>
}
```

---

## 11. WebSocket Client

The backend WebSocket runs at `wss://<host>/ws/markets` with a plain JSON protocol.

```typescript
// src/ws/predikt-websocket.ts

export class PrediktWebSocket {
  connect(): Promise<void>
  subscribe(marketIds: string[]): void
  unsubscribe(marketIds: string[]): void
  onMarketUpdate(listener: (update: MarketUpdate) => void): () => void
  disconnect(): void
}

export interface MarketUpdate {
  type: 'market_update';
  marketId: string;
  matchedMarketId: string | null;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  timestamp: number;
}
```

Client sends `{ action: 'set_subscriptions', marketIds: [...] }` to subscribe. Server pushes `MarketUpdate` events. A 30-second ping (`{ action: 'ping' }`) keeps the connection alive.

**Tracked fields** in `changes`: `yesAsk`, `yesBid`, `noAsk`, `noBid`, `volume`, `liquidity`, `status`, `winningOutcome`.

---

## 12. Error Handling

```typescript
// src/errors.ts
export class PrediktError extends Error {
  constructor(public readonly statusCode: number, public readonly body: unknown) { ... }

  get isUnauthorized() { return this.statusCode === 401; }
  get isForbidden()    { return this.statusCode === 403; }
  get isNotFound()     { return this.statusCode === 404; }
  get isServerError()  { return this.statusCode >= 500; }
}
```

```typescript
import { PrediktError } from '@predikt/sdk';

try {
  const order = await client.buy.create({ ... });
} catch (e) {
  if (e instanceof PrediktError && e.isUnauthorized) {
    // prompt re-login
  }
  throw e;
}
```

---

## 13. Testing Strategy

Use `vitest` with a fetch mock. No running server required for unit tests.

```typescript
function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

it('injects x-api-key on every request', async () => {
  const fetch = mockFetch({ page: 1, limit: 10, total: 0, data: { markets: [] } });
  const client = new PrediktClient({ baseUrl: 'https://api.example.com', apiKey: 'sk_test', fetch });
  await client.markets.list();
  const [, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk_test');
});

it('omits Authorization when no token is set', async () => {
  const fetch = mockFetch({});
  const client = new PrediktClient({ baseUrl: 'https://api.example.com', apiKey: 'key', fetch });
  await client.markets.list();
  const [, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)['authorization']).toBeUndefined();
});

it('includes Authorization after setToken', async () => {
  const fetch = mockFetch({});
  const client = new PrediktClient({ baseUrl: 'https://api.example.com', apiKey: 'key', fetch });
  client.setToken('my-jwt');
  await client.markets.list();
  const [, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer my-jwt');
});
```

Integration tests in `tests/integration/` require `PREDIKT_INTEGRATION=true` and hit a real server.

---

## 14. Versioning

The version lives in one place: the `version` field in `package.json`. You never edit it by hand — you use:

```bash
npm version patch   # 0.1.0 → 0.1.1  (bug fix, no API change)
npm version minor   # 0.1.0 → 0.2.0  (new method added, backward compatible)
npm version major   # 0.1.0 → 1.0.0  (breaking change)
```

**What `npm version` does under the hood:**

1. Updates `version` in `package.json`
2. Creates a git commit: `git commit -m "0.1.1"`
3. Creates a git tag: `git tag v0.1.1`

After that you run:

```bash
git push && git push --tags
```

The `git push --tags` is the trigger — GitHub Actions watches for tags matching `v*` and starts the publish pipeline automatically.

**What version numbers mean for integrators:**

Integrators who installed `@predikt/sdk@0.1.0` will get `0.1.x` patches automatically (npm's default update behavior). They must explicitly upgrade for minor and major bumps. This is why the rules matter:

| Change | Bump | Why |
|--------|------|-----|
| Bug fix in HTTP client | `patch` | Safe to auto-update |
| New method added | `minor` | Backward compatible, safe to upgrade without reading changelog |
| Method removed or renamed | `major` | Integrators must review their code before upgrading |
| Parameter type changed | `major` | Same as above |
| Backend adds a new optional field to a response | `patch` | Existing code still works |
| Backend removes a field from a response | `major` | Integrators may depend on it |

---

## 15. CHANGELOG.md

The changelog lives in the root of the SDK repo, committed to git alongside the source. It is a human-written log of every notable change per version. It does not exist in the aggregator repo.

**Format (Keep a Changelog convention):**

```markdown
# Changelog

## [0.2.0] - 2026-06-10
### Added
- `BuyResource.createBatch()` for multi-market batch orders
- `SellResource.linkBatchChainTx()` for batch sell confirmation

## [0.1.1] - 2026-06-05
### Fixed
- `PriceHistoryResource.forMarket()` was sending `startTs` as a string instead of number

## [0.1.0] - 2026-06-01
### Added
- Initial release: Auth, Markets, Buy, Sell, Redeem, Orders, Positions, WebSocket
```

**Purpose:** It answers the question integrators ask every time they see a new version — *"what changed and do I need to do anything?"* Without it they would have to read raw git diffs. It is especially important for `major` bumps where they need to know exactly what broke and how to migrate.

It is not auto-generated. You write it before running `npm version`. It is included in the published package (listed in `files`) so integrators can read it directly on npmjs.com.

---

## 16. Publishing to npm and CI/CD

### GitHub Actions workflow

```yaml
# .github/workflows/publish.yml
name: Publish SDK

on:
  push:
    tags: ['v*']       # only fires when a tag like v0.1.1, v1.0.0 is pushed

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Step by step explanation

**`on: push: tags: ['v*']`** — this workflow does not run on every commit, only when a git tag starting with `v` is pushed. That tag was created by `npm version` on your machine. This is the gate: you control exactly when a publish happens by deciding when to tag.

**`actions/checkout@v4`** — clones the SDK repo into the runner (a temporary Ubuntu VM provided by GitHub). At this point `dist/` does not exist because it is in `.gitignore`.

**`actions/setup-node@v4` with `registry-url`** — installs Node 20 and points npm at the official registry. The `registry-url` field is what makes `NODE_AUTH_TOKEN` work — without it, npm does not know where to authenticate.

**`npm ci`** — installs exactly what is in `package-lock.json`. Never `npm install` — `ci` is deterministic and fails if the lock file is out of sync with `package.json`.

**`npm run build`** — runs the two `tsc` commands and creates `dist/` on the runner for the first time.

**`npm test`** — runs vitest. If any test fails the workflow stops here and nothing is published. This is the safety net.

**`npm publish --access public`** with `NODE_AUTH_TOKEN` — authenticates to npm using a token stored in GitHub repository secrets (Settings → Secrets → `NPM_TOKEN`). This is an npm automation token you generate once on npmjs.com. `--access public` is required for scoped packages (`@predikt/sdk`) to be publicly installable; without it npm defaults to private.

### Full lifecycle from tag to live package

```
your machine                GitHub Actions              npm registry
─────────────               ──────────────              ────────────
npm version minor
  → updates package.json
  → git commit
  → git tag v0.2.0
git push --tags  ──────→  workflow starts
                           checkout repo
                           setup Node 20
                           npm ci
                           npm run build  → dist/ created
                           npm test       → all pass
                           npm publish    ──────────────→  @predikt/sdk@0.2.0 live
```

The whole pipeline takes about 60–90 seconds. Once it finishes any integrator running `npm install @predikt/sdk@0.2.0` gets the new version immediately.

---

## 17. Keeping the SDK Up to Date

Once the SDK is published, the most important question is: **how do you make sure it stays correct as the backend evolves?** This requires defined processes, not just good intentions.

### The three triggers that require an SDK update

**1. A backend DTO changes shape**
Something in `src/modules/*/dto/` or `src/core/domain/types/` changes — a field is renamed, a new required field is added, an enum value is added or removed.

**2. A new `/sdk/v1/` route is added to the aggregator**
A new SDK controller method is added on the backend that the SDK does not yet know about.

**3. A route is removed or its request/response contract changes**
The backend breaks an existing contract that integrators may depend on.

---

### Process 1 — Aggregator PR checklist

Add a checklist item to every aggregator PR that touches controllers, DTOs, or core types:

```
## SDK impact
- [ ] Does this change affect any /sdk/v1/ route?
- [ ] Does this change affect any DTO in src/modules/*/dto/ or src/core/domain/types/?
- [ ] If yes: has a corresponding SDK PR been opened or scheduled?
```

This makes the SDK impact visible at review time, not after deployment.

---

### Process 2 — Type sync script

Maintain a script `scripts/sync-types.ts` in the SDK repo that reads the aggregator source and flags differences:

```bash
# run from inside predikt-sdk/
AGGREGATOR_PATH=../predikt-aggregator npx ts-node scripts/sync-types.ts
```

The script:
1. Reads enum values from `src/core/domain/types/` in the aggregator
2. Compares them to `src/types/enums.ts` in the SDK
3. Prints a diff of any added, removed, or changed values
4. Exits with code 1 if there is a mismatch (so it can be used in CI)

Run this script every time the aggregator is updated. If it exits 1, update the SDK types and cut a release.

---

### Process 3 — Integration test suite against staging

Maintain integration tests in `tests/integration/` that run against the staging server on every aggregator deployment:

```bash
PREDIKT_INTEGRATION=true PREDIKT_BASE_URL=https://staging.predikt.gg \
  PREDIKT_API_KEY=sk_predikt_staging_... npx vitest --config vitest.integration.config.ts
```

These tests call real endpoints and assert on response shapes:

```typescript
it('GET /sdk/v1/markets returns expected shape', async () => {
  const result = await client.markets.list({ limit: 1 });
  expect(result).toHaveProperty('page');
  expect(result).toHaveProperty('data.markets');
  expect(result.data.markets[0]).toHaveProperty('id');
  expect(result.data.markets[0]).toHaveProperty('platform');
});
```

If these break after an aggregator deployment, a type mismatch is immediately visible before integrators are affected.

---

### Process 4 — Linked release notes

Every aggregator release that affects the SDK surface should reference the corresponding SDK version in its release notes, and vice versa. This creates a traceable link:

```
aggregator v2.4.0 release notes:
  - Changed /sdk/v1/markets response: added `rules` field to MarketDto
  - Requires SDK >= 0.3.0

SDK CHANGELOG.md v0.3.0:
  - Added `rules: string` to `MarketDto` (aggregator v2.4.0+)
```

---

### Process 5 — Deprecation before removal

When the backend needs to remove or rename something on the SDK surface, follow this sequence:

**Step 1 — Add deprecation to SDK (minor bump)**
```typescript
/** @deprecated Use `yesBid` instead. Will be removed in v2.0.0. */
yesBidLegacy?: number;
```

**Step 2 — Keep both old and new fields live on the backend for one release cycle**

**Step 3 — Remove the deprecated field from the SDK (major bump)**

This gives integrators at least one version to migrate before the break.

---

### Process 6 — API key rotation

When an integrator's key needs to be rotated or a new integrator is onboarded:

1. Add the new key alongside the existing one on the backend (accept both for a migration window).
2. Share the new key with the integrator out-of-band.
3. Once the integrator confirms they are using the new key, revoke the old one.

The `sdk.apiKey` config in `sdk.config.ts` can be upgraded to `sdk.apiKeys: string[]` and the guard updated to `apiKeys.includes(provided)` to support this.

---

### Decision chart for each aggregator change

```
Backend change merged
        │
        ▼
Does it affect /sdk/v1/* or shared DTOs?
        │
   No ──┘                Yes
                          │
              ┌───────────┼───────────┐
              │           │           │
         New field    Changed     Removed/
         added        field       renamed
              │           │           │
          patch bump   major bump  major bump
              │           │           │
         Update types  Deprecate   Remove after
         + publish     first       deprecation
                       (minor)     window
```

---

## 18. Long-Term: OpenAPI-Driven Generation

All of §17 is necessary only because types are duplicated between the two repos. The long-term solution eliminates that duplication:

1. Add `@nestjs/swagger` to the aggregator and decorate all SDK controllers with `@ApiProperty()`.
2. The spec is automatically served at `/api-json`.
3. In the SDK repo, the `sync-types` script becomes:

```bash
npx openapi-typescript https://staging.predikt.gg/api-json -o src/types/api.d.ts
```

4. The hand-written resource methods stay (they add ergonomics), but their return types come from the generated file.

This means types are never manually duplicated. They are always generated from the backend's own Swagger spec, which is compiled directly from the TypeScript source. Type drift becomes structurally impossible.

### API key rotation (future)

Once multiple integrators exist, `sdk.apiKey` becomes `sdk.apiKeys: string[]` and the guard becomes:

```typescript
if (!apiKeys.includes(provided)) {
  throw new UnauthorizedException('Invalid or missing API key');
}
```

Each integrator gets their own key, enabling per-key rate limiting, analytics, and revocation without affecting others.

---

## 19. Implementation Roadmap

The complete ordered sequence for going from this guide to a publicly available, maintained SDK.

---

### Step 1 — Implement the backend SDK module (predikt-aggregator)

All work happens inside this repo:

- Create `src/config/sdk.config.ts` — registers `SDK_API_KEY` from env with a hardcoded local fallback
- Create `src/modules/sdk/guards/api-key.guard.ts` — validates `x-api-key` header
- Create `src/modules/sdk/controllers/` — one controller per resource group (`sdk-auth`, `sdk-markets`, `sdk-matched-markets`, `sdk-price-history`, `sdk-buy`, `sdk-sell`, `sdk-redeem`, `sdk-orders`, `sdk-positions`), all under `/sdk/v1/` prefix
- Add missing service exports to existing modules (`AuthService`, `BuyService`, `SellService`, `RedeemService`, `OrdersService`, `PriceHistoryService`)
- Create `src/modules/sdk/sdk.module.ts` and register it in `AppModule`
- Add `sdkConfig` to the `ConfigModule.forRoot` load array in `AppModule`

---

### Step 2 — Implement the SDK TypeScript package

Create the `predikt-sdk/` directory:

- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.cjs.json`
- `src/errors.ts` — `PrediktError` class
- `src/http.ts` — `HttpClient` with API key + JWT injection
- `src/client.ts` — `PrediktClient` constructor wiring all resources
- `src/types/` — enums and interfaces copied from aggregator core
- `src/resources/` — one file per resource group (auth, markets, matched-markets, price-history, positions, orders, buy, sell, redeem)
- `src/ws/predikt-websocket.ts` — typed WebSocket wrapper
- `src/index.ts` — public barrel re-exporting everything

---

### Step 3 — Build and verify /dist output

```bash
npm run build
```

Inspect `dist/` to confirm all three outputs are present:

```
dist/
├── esm/        # ES module output for bundlers
├── cjs/        # CommonJS output for plain Node
└── types/      # .d.ts declaration files
```

Check that `dist/cjs/index.js` uses `require()`/`module.exports` and `dist/esm/index.js` uses `import`/`export`. Verify `dist/types/index.d.ts` exposes all public types.

Run `npm link` so the package can be consumed locally without publishing:

```bash
npm link   # registers @predikt/sdk globally on your machine
```

---

### Step 4 — Implement mock Node.js project and test locally against localhost:3000

1. Start the aggregator: `npm run start:dev`
2. Add `SDK_API_KEY=sk_predikt_d4f8a2e6b1c9f3a7e5d2b8f4c6a9e1d3` to the aggregator's `.env`
3. Create a small standalone project (e.g. `predikt-sdk-playground/`) and link the SDK:

```bash
npm link @predikt/sdk
```

4. Point the client at localhost and exercise all major flows:

```typescript
import { PrediktClient, WalletChain } from '@predikt/sdk';

const client = new PrediktClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'sk_predikt_d4f8a2e6b1c9f3a7e5d2b8f4c6a9e1d3',
});

// public endpoint — no JWT needed
const markets = await client.markets.list({ limit: 5 });
console.log(markets.data.markets);

// auth flow
const { message, nonce } = await client.auth.challenge({
  walletAddress: '...',
  chain: WalletChain.SOLANA,
});
// sign message with wallet, then:
const { access_token } = await client.auth.verify({ ... });
client.setToken(access_token);

// JWT-protected endpoint
const positions = await client.positions.list({ userAddress: '...' });
console.log(positions);
```

Iterate here until the local integration works end-to-end. This playground also serves as the quickstart example for integrators.

---

### Step 5 — Create predikt-sdk repo on GitHub and push

The GitHub Actions workflow file is just code — it lives in `.github/workflows/` and is pushed along with everything else. The `NPM_TOKEN` secret however lives in GitHub repository settings and can only be added once the repo exists.

The correct sequence inside this step:

1. `git init`, initial commit (including `.github/workflows/publish.yml`), push to GitHub
2. Go to GitHub repo → **Settings → Secrets and variables → Actions** → add `NPM_TOKEN` (generate this token once on npmjs.com under Account → Access Tokens → Automation token)
3. Register the `@predikt` npm scope — create the `predikt` organization on npmjs.com or verify you already own it

The workflow file is now live and the secret is in place. The pipeline will trigger automatically the first time a `v*` tag is pushed in step 7.

---

### Step 6 — Write README.md for the SDK repo

The README is what every integrator reads first on GitHub and npmjs.com. It should cover:

- What the SDK is (one paragraph)
- Installation: `npm install @predikt/sdk`
- Quick start: initialize the client, call a public endpoint, do the auth flow
- Authentication section (API key + JWT explained)
- Link to full API reference or docs website
- Requirements (Node 18+, TypeScript 4.9+)
- How to report issues / contribute

---

### Step 7 — Write and run tests, publish first version

- Write unit tests (mocked fetch) for every resource class
- Write integration tests against localhost
- Run `npm test` and confirm all pass
- Run `npm run lint`
- Update `CHANGELOG.md` with the initial release entry
- Run `npm version 0.1.0` — updates `package.json`, creates git commit and `v0.1.0` tag
- Run `git push && git push --tags` — triggers GitHub Actions, publishes to npm
- Confirm `@predikt/sdk@0.1.0` is live on npmjs.com

---

### Step 8 — Establish maintaining processes

Put the processes from §17 into practice as standing team agreements:

- Add the SDK impact checklist to the aggregator PR template (`.github/pull_request_template.md`)
- Schedule the type sync script to run on every aggregator release (add it to the aggregator's CI pipeline as a check)
- Set up integration tests to run against staging automatically after each aggregator deployment
- Document who is responsible for cutting SDK releases when aggregator changes require it

---

### Step 9 — Update Predikt docs website

- Add an SDK section to the docs site covering: overview, installation, authentication, endpoint reference
- Include a **live playground** with a read-only dummy API key so developers can try `GET /sdk/v1/markets` without signing up
- Link to the npmjs.com package and the GitHub repo
- The dummy key should be rate-limited and scoped to read-only endpoints only

---

### Step 10 — Design and implement real API key management

When there are multiple integrators, the hardcoded single key approach no longer works. Plan for:

- A database table storing keys: `(id, key_hash, integrator_name, created_at, revoked_at, scopes[])`
- Store only the hash of the key (bcrypt or SHA-256), never the raw value
- Issue keys via an admin endpoint or manually for now
- The `ApiKeyGuard` queries the table instead of comparing to a config value
- Add per-key rate limiting (e.g. via a Redis counter per key per minute)
- Add key rotation support: issue new key, accept both during migration window, revoke old key
- Expose a self-service key management UI to integrators (longer term)
