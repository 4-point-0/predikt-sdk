# @prediktgg/sdk

Official TypeScript SDK for the Predikt prediction-market aggregator. Provides typed access to markets, trading (buy/sell/redeem), orders, positions, price history, and real-time WebSocket updates across Polymarket, Kalshi, and Limitless.

> **Integrating Polymarket Combos or direct trading on Privy wallets?** Start with the step-by-step **[Integration guide](https://github.com/4-point-0/predikt-sdk/blob/main/INTEGRATION_GUIDE.md)** (also shipped in the package as `INTEGRATION_GUIDE.md`).

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Initialization](#initialization)
- [Authentication](#authentication)
- [Markets](#markets)
- [Trading - Buy](#trading---buy)
- [Trading - Sell](#trading---sell)
- [Trading - Redeem](#trading---redeem)
- [Orders](#orders)
- [Positions](#positions)
- [Price History](#price-history)
- [WebSocket](#websocket)
- [Users](#users)
- [Direct Trading and Polymarket Combos (server-side)](#direct-trading-and-polymarket-combos-server-side)
- [Error Handling](#error-handling)
- [Type Reference](#type-reference)

---

## Requirements

- Node.js >= 18 (recommended: the latest 22.x or 24.x LTS release; Node.js 18 and 20 are end-of-life and get no security fixes)
- TypeScript >= 5 (recommended; plain JS works too)

---

## Installation

```bash
npm install @prediktgg/sdk
# or
yarn add @prediktgg/sdk
# or
pnpm add @prediktgg/sdk
```

---

## Initialization

Create one `PrediktSDK` instance and reuse it across your application. The SDK holds a single HTTP client and token state shared across all resource clients.

```typescript
import { PrediktSDK } from '@prediktgg/sdk';

const sdk = new PrediktSDK({
  baseUrl: 'https://api.predikt.xyz',  // base URL of the Predikt API
  apiKey: 'your-api-key',              // required on every request via x-api-key header
});
```

If you are restoring a session (e.g. from local storage after a page reload), pre-set the JWT token so authenticated requests work immediately without requiring the user to sign in again:

```typescript
const savedToken = localStorage.getItem('predikt_token');

const sdk = new PrediktSDK({
  baseUrl: 'https://api.predikt.xyz',
  apiKey: 'your-api-key',
  token: savedToken ?? undefined,  // skipped if null/undefined
});
```

### Token management

After a successful `auth.verify()` call the JWT is stored inside the SDK automatically and attached to every subsequent HTTP request as `Authorization: Bearer <token>`. You can also control the token directly:

```typescript
sdk.setToken(token);   // overwrite the stored token
sdk.getToken();        // returns string | undefined
sdk.clearToken();      // removes the token (call on logout)
```

---

## Authentication

Predikt uses a wallet-based challenge-response authentication flow. The server issues a one-time nonce, the user signs it with their wallet, and the signature is verified server-side to issue a JWT. No passwords or email addresses are involved.

The flow has three steps:
1. Request a challenge nonce for the wallet address.
2. Sign the returned message with the user's wallet (this step happens outside the SDK in your wallet library).
3. Submit the signature to verify and receive a JWT. The SDK stores it automatically.

### Step 1 - Get a challenge

```typescript
import { WalletChain } from '@prediktgg/sdk';

const challenge = await sdk.auth.getChallenge(walletAddress, chain);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletAddress` | `string` | The user's public wallet address |
| `chain` | `WalletChain` | The blockchain the wallet belongs to (`WalletChain.SOLANA` or `WalletChain.SUI`) |

**Response - `ChallengeResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `nonce` | `string` | A unique single-use token that must be included in the verify call |
| `message` | `string` | The exact string the user must sign with their wallet |
| `isNewUser` | `boolean` | `true` if this wallet address has never authenticated before - useful for showing a sign-up flow |

```typescript
const { nonce, message, isNewUser } = await sdk.auth.getChallenge(
  '7xKXtg2CW87d97TXJSDpxFnR3ys1',
  WalletChain.SOLANA,
);

if (isNewUser) {
  // show onboarding UI
}
```

### Step 2 - Sign the message

Sign `message` using your wallet library. This step is outside the SDK - the exact signing method depends on the chain and wallet adapter you use:

```typescript
// Solana example using a wallet adapter
const messageBytes = new TextEncoder().encode(message);
const signatureBytes = await walletAdapter.signMessage(messageBytes);
const signature = Buffer.from(signatureBytes).toString('base64');
```

### Step 3 - Verify and receive a JWT

Submit the signature to obtain a JWT. The SDK stores it internally so you do not need to call `setToken()` manually.

```typescript
const result = await sdk.auth.verify({
  walletAddress: '7xKXtg2CW87d97TXJSDpxFnR3ys1',
  chain: WalletChain.SOLANA,
  nonce,              // nonce from step 1
  signature,          // base64 signature from step 2
  referralCode: 'FRIEND123',  // optional - referral code from an existing user
});
```

**Parameters - `VerifyRequest`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `walletAddress` | `string` | Yes | Must match the address used in `getChallenge` |
| `chain` | `WalletChain` | Yes | Must match the chain used in `getChallenge` |
| `nonce` | `string` | Yes | The nonce returned by `getChallenge` |
| `signature` | `string` | Yes | Base64-encoded signature of the challenge message |
| `referralCode` | `string` | No | Referral code of the user who invited this account |

**Response - `VerifyResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | `string` | JWT bearer token - the SDK stores this automatically |

```typescript
const { access_token } = result;

// Persist across page reloads if needed:
localStorage.setItem('predikt_token', access_token);
```

All subsequent SDK calls attach `Authorization: Bearer <token>` automatically.

---

## Markets

The markets module lets you browse, search, and filter prediction markets. Predikt groups markets from different platforms (Polymarket, Kalshi, Limitless) that cover the same real-world event into **market groups**. A group may contain one market (platform-exclusive) or several markets (cross-platform matched).

### List markets

Returns a paginated list of market groups. Use this as the main discovery endpoint.

```typescript
import { MarketCategory, MarketSortOption, PlatformType, SortOrder } from '@prediktgg/sdk';

// Minimal - fetch the default listing
const result = await sdk.markets.list();

// Full - with all filters applied
const result = await sdk.markets.list({
  search: 'bitcoin',
  categories: [MarketCategory.CRYPTO, MarketCategory.ECONOMICS],
  platforms: [PlatformType.POLYMARKET, PlatformType.KALSHI],
  sort: MarketSortOption.VOLUME,
  sortOrder: SortOrder.DESC,
  onlyMatched: true,
  page: 1,
  limit: 20,
});
```

**Parameters - `MarketsQuery` (all optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | `string` | Full-text search on market titles |
| `categories` | `MarketCategory[]` | Filter to one or more categories |
| `platforms` | `PlatformType[]` | Filter to one or more platforms |
| `sort` | `MarketSortOption` | Sort field: `NEWEST`, `VOLUME`, `LIQUIDITY`, or `CLOSING` |
| `sortOrder` | `SortOrder` | `ASC` or `DESC` (default is `DESC`) |
| `onlyMatched` | `boolean` | When `true`, only returns groups that contain markets matched across multiple platforms |
| `page` | `number` | Page number, 1-indexed |
| `limit` | `number` | Number of groups per page |

**Response - `PaginatedMarketGroups`:**

```typescript
console.log(result.data.markets);           // MarketGroupDto[]
console.log(result.pagination.totalItems);
console.log(result.pagination.totalPages);
console.log(result.pagination.hasNext);
console.log(result.pagination.hasPrev);
```

Each `MarketGroupDto` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Group identifier |
| `title` | `string` | Human-readable event title |
| `description` | `string` | Extended event description |
| `category` | `MarketCategory` | Event category |
| `totalVolume` | `string` | Combined trading volume across all markets in the group (USD) |
| `totalLiquidity` | `string` | Combined liquidity across all markets in the group (USD) |
| `isGroupOfMultipleMarkets` | `boolean` | `true` if the group contains markets from more than one platform |
| `markets` | `MarketDto[]` | The individual platform markets within the group |
| `isFavourite` | `boolean \| undefined` | Whether the requesting user has favorited this group (only populated when a wallet address is provided) |

Each `MarketDto` within `markets` contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Market identifier used in all other SDK calls |
| `platform` | `PlatformType` | The platform this market lives on |
| `ticker` | `string` | Platform-specific ticker symbol used in trading calls |
| `title` | `string` | Market title on that platform |
| `status` | `MarketStatus` | Current lifecycle status |
| `yesAsk` / `yesBid` | `number` | Current YES ask and bid prices (0-1 range) |
| `noAsk` / `noBid` | `number` | Current NO ask and bid prices (0-1 range) |
| `volume` | `number` | Total trading volume in USD |
| `liquidity` | `number` | Current liquidity in USD |
| `isBestOddsYes` | `boolean \| null` | Whether this market has the best YES price in its group |
| `isBestOddsNo` | `boolean \| null` | Whether this market has the best NO price in its group |
| `startDate` / `endDate` | `string \| null` | ISO 8601 timestamps for market open and close |
| `imageUrl` | `string \| null` | URL of the market image |

### Get a market group by market ID

Fetches full details for a market group given any market ID that belongs to it. This is the detail view endpoint - it returns the same data as `list()` plus `bestOdds` across the group.

```typescript
// Without wallet - isFavourite will be undefined
const group = await sdk.markets.get('market-id-abc');

// With wallet - isFavourite is populated
const group = await sdk.markets.get('market-id-abc', '7xKXtg2CW87d97TXJSDpxFnR3ys1');
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Any market ID within the group (not the group ID) |
| `wallet` | `string` | No | Wallet address used to populate the `isFavourite` flag |

**Response - `MarketGroupDetailsDto`:**

Extends `MarketGroupDto` with:

| Field | Type | Description |
|-------|------|-------------|
| `bestOdds.marketBestOddsForYes` | `string \| null` | Best YES ask price across all markets in the group |
| `bestOdds.marketBestOddsForNo` | `string \| null` | Best NO ask price across all markets in the group |

```typescript
console.log(group.title);
console.log(group.bestOdds.marketBestOddsForYes);
console.log(group.markets);  // MarketDto[] - one entry per platform
```

### Get a market group by matched-market ID

Fetches a market group using the matched-market identifier (the cross-platform link ID) rather than a constituent market ID.

```typescript
// Without wallet
const group = await sdk.markets.getByMatchedMarketId('matched-market-id-xyz');

// With wallet - pass as query parameter manually if isFavourite is needed
// (use markets.get() instead when you have a constituent market ID)
```

### Get a matched group via any constituent market ID

An alternative lookup that resolves the group through its matched-market relationship. Use this when you have a market ID and specifically need the cross-platform matched view.

```typescript
const group = await sdk.markets.getMatchedGroup('market-id-abc');
```

### World Cup 2026

A scoped version of `list()` filtered to World Cup 2026 markets. Accepts the same `MarketsQuery` parameters.

```typescript
// Minimal - all World Cup 2026 markets
const result = await sdk.markets.getWorldCup2026();

// With sorting
const result = await sdk.markets.getWorldCup2026({
  sort: MarketSortOption.CLOSING,
  sortOrder: SortOrder.ASC,
  page: 1,
  limit: 20,
});
```

### Favorites

Favorites are stored per wallet and require authentication. A favorite is attached to a market ID, but the list endpoint returns full market groups containing that market.

```typescript
// Add a market to favorites
await sdk.markets.addFavorite('market-id-abc');

// Remove a market from favorites
await sdk.markets.removeFavorite('market-id-abc');

// List favorites - paginated, same shape as markets.list()
const result = await sdk.markets.listFavorites({
  wallet: '7xKXtg2CW87d97TXJSDpxFnR3ys1',  // required
  page: 1,
  limit: 20,
});
```

**Parameters - `FavoritesQuery`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `wallet` | `string` | Yes | Wallet address whose favorites to retrieve |
| `search`, `sort`, `sortOrder`, `categories`, `platforms`, `page`, `limit` | - | No | Same filters as `MarketsQuery` |

---

## Trading - Buy

Buying positions follows three steps: simulate to check prices, create an order to get a transaction to sign, then submit the on-chain transaction hash to activate the order. The aggregator bridges USDC from Solana or Sui to the target prediction market platform.

### Step 1 - Simulate (optional but recommended)

Simulation returns the expected fill across all platforms without committing to an order. Use it to show the user a price preview and to identify which platform offers the best rate before creating an order.

```typescript
import { Outcome, PlatformType } from '@prediktgg/sdk';

// Minimal - simulate on a specific platform
const simulation = await sdk.buy.simulate({
  platform: PlatformType.POLYMARKET,
  ticker: 'BTC-25K-DEC',
  outcome: Outcome.YES,
  usdcAmount: '10000000',
});

// The response is a map of platform to simulation result, plus the best platform overall
console.log(simulation.bestPlatform);                    // e.g. PlatformType.POLYMARKET
console.log(simulation.polymarket?.fullyFillable);       // false if liquidity is insufficient
console.log(simulation.polymarket?.totalContracts);      // contracts you would receive
console.log(simulation.polymarket?.averagePrice);        // weighted average price per contract
console.log(simulation.polymarket?.totalCost);           // actual USDC cost of the fill
console.log(simulation.polymarket?.fills);               // per-level fill breakdown
```

**Parameters - `SimulateBuyRequest`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `platform` | `PlatformType` | Yes | Platform to simulate the buy on |
| `ticker` | `string` | Yes | Market ticker symbol (visible on the market object) |
| `outcome` | `Outcome` | Yes | `Outcome.YES` (0) or `Outcome.NO` (1) |
| `usdcAmount` | `string` | Yes | USDC to spend, expressed with 6 decimal places (e.g. `"10000000"` = 10 USDC) |

**Response - `SimulateAllResponse`:**

The response is a partial map keyed by `PlatformType`, so any platform may be present or absent.

| Field | Type | Description |
|-------|------|-------------|
| `[platform]` | `SimulateOrderResponse` | Simulation result for that platform |
| `bestPlatform` | `PlatformType \| undefined` | The platform with the best overall price |

Each `SimulateOrderResponse`:

| Field | Type | Description |
|-------|------|-------------|
| `fullyFillable` | `boolean` | Whether the full requested amount can be filled at current liquidity |
| `totalCost` | `string` | Total USDC required to fill the order |
| `totalContracts` | `string` | Number of position contracts you would receive |
| `averagePrice` | `string` | Weighted average price per contract across all fills |
| `bestPrice` | `string \| null` | Best (cheapest) single price available |
| `worstPrice` | `string \| null` | Worst (most expensive) price consumed by this fill |
| `levelsConsumed` | `number` | Number of order book price levels the fill consumed |
| `fills` | `SimulatedFill[]` | Array of individual fills, each with `price`, `size`, and `cost` |

### Step 2 - Create a buy order

Creates the order and returns an unsigned transaction that must be signed and submitted on-chain by the user.

```typescript
import { SourceChain } from '@prediktgg/sdk';

// Minimal - only required fields (sourceChain defaults to SOLANA, slippage defaults to 2.5%)
const { order, transaction, quote } = await sdk.buy.createOrder({
  ticker: 'BTC-25K-DEC',
  source: PlatformType.POLYMARKET,
  outcome: Outcome.YES,
  usdcAmount: '10000000',
});

// Full - with all options
const { order, transaction, quote } = await sdk.buy.createOrder({
  ticker: 'BTC-25K-DEC',
  source: PlatformType.POLYMARKET,
  outcome: Outcome.YES,
  usdcAmount: '10000000',
  sourceChain: SourceChain.SOLANA,
  slippagePercent: 3.0,
});
```

**Parameters - `BuyOrderRequest`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticker` | `string` | Yes | Market ticker symbol |
| `source` | `PlatformType` | Yes | Platform to buy on |
| `outcome` | `Outcome` | Yes | `Outcome.YES` or `Outcome.NO` |
| `usdcAmount` | `string` | Yes | USDC to spend with 6 decimal places |
| `sourceChain` | `SourceChain` | No | Chain to bridge USDC from - `SourceChain.SOLANA` (default) or `SourceChain.SUI` |
| `slippagePercent` | `number` | No | Maximum acceptable price slippage as a percentage. Minimum is `2.5`, defaults to `2.5`. The order will fail on-chain if price moves beyond this threshold |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `order` | `BuyOrderResponse` | The created order, initially in `PENDING` status |
| `order.id` | `string` | Order ID - save this to track the order and to call `setTxHash` |
| `transaction.bytes` | `string` | Base64-encoded unsigned transaction bytes - decode, sign, and submit on-chain |
| `quote.expectedOutput` | `string` | Expected number of contracts after bridging and buying |
| `quote.bridgeFee` | `string` | Mayan bridge fee deducted from your USDC amount |
| `quote.estimatedTime` | `number` | Estimated seconds until the order is fully settled |

```typescript
// Decode and sign the transaction (Solana example)
const txBytes = Buffer.from(transaction.bytes, 'base64');
const txSignature = await wallet.signAndSendTransaction(txBytes);
```

### Step 3 - Register the on-chain transaction hash

After submitting the transaction on-chain, pass the resulting hash to the aggregator. This links the bridge transaction to the order and moves it from `PENDING` to `EXECUTING`.

```typescript
const updatedOrder = await sdk.buy.setTxHash(order.id, onChainTxHash);

console.log(updatedOrder.status);        // BuyOrderStatus.EXECUTING
console.log(updatedOrder.bridgeTxHash);  // the hash you just registered
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orderId` | `string` | The order ID returned by `createOrder` |
| `bridgeTxHash` | `string` | The on-chain transaction hash from submitting the bridge transaction |

### Batch buy

Create multiple buy orders in a single API call. The aggregator groups orders with compatible bridge parameters into a single transaction where possible, reducing gas overhead. Each group gets one transaction.

```typescript
const batch = await sdk.buy.createBatch([
  {
    ticker: 'BTC-25K-DEC',
    source: PlatformType.POLYMARKET,
    outcome: Outcome.YES,
    usdcAmount: '5000000',
  },
  {
    ticker: 'ETH-3K-DEC',
    source: PlatformType.KALSHI,
    outcome: Outcome.NO,
    usdcAmount: '5000000',
  },
]);

console.log(batch.batchId);
console.log(batch.orders);        // individual order entries with groupId
console.log(batch.transactions);  // one per bridge group, each with groupId + bytes
console.log(batch.quote.totalAmount);
console.log(batch.quote.totalBridgeFee);
console.log(batch.quote.estimatedTime);
```

After submitting all transactions on-chain, register their hashes in one call:

```typescript
await sdk.buy.setBatchTxHashes(batch.batchId, [
  { groupId: batch.transactions[0].groupId, txHash: 'hash-for-group-0' },
  { groupId: batch.transactions[1].groupId, txHash: 'hash-for-group-1' },
]);
```

---

## Trading - Sell

Selling positions follows the same pattern as buying: simulate, create order to get a transaction, submit on Solana and register the signature.

### Step 1 - Simulate

Use simulation to check expected proceeds before committing. The response shape is identical to the buy simulation.

```typescript
// Minimal
const simulation = await sdk.sell.simulate({
  platform: PlatformType.POLYMARKET,
  ticker: 'BTC-25K-DEC',
  outcome: Outcome.YES,
  positionAmount: '10000000',
});

console.log(simulation.polymarket?.averagePrice);
console.log(simulation.polymarket?.totalCost);   // USDC you would receive
```

**Parameters - `SimulateSellRequest`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `platform` | `PlatformType` | Yes | Platform to simulate the sell on |
| `ticker` | `string` | Yes | Market ticker symbol |
| `outcome` | `Outcome` | Yes | The outcome of the position to sell |
| `positionAmount` | `string` | Yes | Number of position tokens to sell, with 6 decimal places |

### Step 2 - Create a sell order

```typescript
// Minimal - sell the full position
const { order, transaction } = await sdk.sell.createOrder({
  ticker: 'BTC-25K-DEC',
  source: PlatformType.POLYMARKET,
  outcome: Outcome.YES,
  positionAmount: '10000000',
});

// Full - partial sell with custom slippage, Sui wallet
const { order, transaction } = await sdk.sell.createOrder({
  ticker: 'BTC-25K-DEC',
  source: PlatformType.POLYMARKET,
  outcome: Outcome.YES,
  positionAmount: '5000000',
  isPartial: true,
  slippagePercent: 3.0,
  sourceChain: SourceChain.SUI,
  positionId: '0xSuiPositionObjectId',  // Sui only
});
```

**Parameters - `SellOrderRequest`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticker` | `string` | Yes | Market ticker symbol |
| `source` | `PlatformType` | Yes | Platform the position is on |
| `outcome` | `Outcome` | Yes | The outcome of the position |
| `positionAmount` | `string` | Yes | Position tokens to sell with 6 decimal places |
| `isPartial` | `boolean` | No | `false` (default) sells the entire position; `true` sells only the specified `positionAmount` |
| `slippagePercent` | `number` | No | Maximum acceptable slippage percentage, minimum `2.5`, defaults to `2.5` |
| `sourceChain` | `SourceChain` | No | Chain the position is on, defaults to `SourceChain.SOLANA` |
| `positionId` | `string` | No | Sui position object ID - only required for Sui wallets; auto-resolved if omitted |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `order` | `SellOrderResponse` | Created order in `PENDING` status |
| `order.id` | `string` | Order ID for tracking and for `setSolanaTx` |
| `order.positionAmount` | `string` | Actual position amount being sold |
| `order.isPartial` | `boolean` | Whether this is a partial sell |
| `transaction.bytes` | `string` | Base64-encoded unsigned transaction to sign and submit on Solana |

### Step 3 - Register the Solana transaction signature

```typescript
const updatedOrder = await sdk.sell.setSolanaTx(order.id, solanaTxSignature);
console.log(updatedOrder.status);  // SellOrderStatus.EXECUTING
```

### Batch sell

Sell multiple positions in a single API call. All sell orders in a batch share one transaction.

```typescript
const batch = await sdk.sell.createBatch([
  { ticker: 'BTC-25K-DEC', source: PlatformType.POLYMARKET, outcome: Outcome.YES, positionAmount: '5000000' },
  { ticker: 'ETH-3K-DEC',  source: PlatformType.KALSHI,     outcome: Outcome.NO,  positionAmount: '3000000' },
]);

const txBytes = Buffer.from(batch.transaction.bytes, 'base64');
// sign and submit on Solana...

await sdk.sell.setBatchChainTx(batch.batchId, solanaTxSignature);
```

---

## Trading - Redeem

Redeeming is used after a market resolves to claim USDC for winning positions. The flow is identical to sell: create an order to receive a transaction, submit it on Solana, then register the signature.

### Step 1 - Create a redeem order

```typescript
// Minimal - redeem the full balance
const { order, transaction } = await sdk.redeem.createOrder({
  ticker: 'BTC-25K-DEC',
  source: PlatformType.POLYMARKET,
  outcome: Outcome.YES,
});

// With a specific amount - redeem only part of the winning position
const { order, transaction } = await sdk.redeem.createOrder({
  ticker: 'BTC-25K-DEC',
  source: PlatformType.POLYMARKET,
  outcome: Outcome.YES,
  sourceChain: SourceChain.SOLANA,
  amount: '5000000',
});
```

**Parameters - `RedeemOrderRequest`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ticker` | `string` | Yes | Market ticker symbol |
| `source` | `PlatformType` | Yes | Platform the winning position is on |
| `outcome` | `Outcome` | Yes | The winning outcome |
| `sourceChain` | `SourceChain` | No | Chain the position is on, defaults to `SourceChain.SOLANA` |
| `amount` | `string` | No | Position tokens to redeem with 6 decimal places. Omit to redeem the full balance |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `order` | `RedeemOrderResponse` | Created order in `PENDING` status |
| `order.id` | `string` | Order ID for tracking and for `setSolanaTx` |
| `order.positionAmount` | `string \| null` | Position amount being redeemed (resolved server-side when omitted from request) |
| `transaction.bytes` | `string` | Base64-encoded unsigned transaction to sign and submit on Solana |

### Step 2 - Register the Solana transaction signature

```typescript
const { order: updatedOrder } = await sdk.redeem.setSolanaTx(order.id, solanaTxSignature);
console.log(updatedOrder.status);       // RedeemOrderStatus.EXECUTING
console.log(updatedOrder.usdcReceived); // null until settlement completes
```

---

## Orders

The orders module provides read access to the history of buy, sell, and redeem orders for the authenticated user. Orders are not paginated in the traditional sense - use `limit` and `offset` for cursor-style pagination.

```typescript
// Fetch a single order by ID
const buyOrder    = await sdk.orders.getBuyOrder('order-id');
const sellOrder   = await sdk.orders.getSellOrder('order-id');
const redeemOrder = await sdk.orders.getRedeemOrder('order-id');

// Fetch a list of orders: { items, total }, newest first
const { items, total } = await sdk.orders.listBuyOrders();
const sellOrders   = await sdk.orders.listSellOrders();
const redeemOrders = await sdk.orders.listRedeemOrders();

// With pagination; more pages exist while offset + items.length < total
const page = await sdk.orders.listBuyOrders({ limit: 50, offset: 0 });
```

**Pagination parameters - `OrdersListQuery` (all optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `number` | Maximum number of orders to return |
| `offset` | `number` | Number of orders to skip (for cursor-style pagination) |

### Order status lifecycle

Orders progress through these statuses. Use polling or WebSocket events to track transitions.

```
Buy:    PENDING -> EXECUTING -> SETTLED | FAILED
Sell:   PENDING -> EXECUTING -> SOLD -> BRIDGING -> SETTLED | FAILED
Redeem: PENDING -> EXECUTING -> BRIDGING -> SETTLED | FAILED
```

Key response fields common to all order types:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique order identifier |
| `status` | `BuyOrderStatus \| SellOrderStatus \| RedeemOrderStatus` | Current lifecycle stage |
| `ticker` | `string` | Market ticker |
| `source` | `PlatformType` | Platform the order is on |
| `outcome` | `Outcome` | YES or NO |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `updatedAt` | `string` | ISO 8601 last update timestamp |
| `settlementTxHash` | `string \| null` | On-chain hash of the final settlement transaction - available once `SETTLED` |
| `usdcReceived` | `string \| null` | USDC received (sell/redeem only) - available once `SETTLED` |

---

## Positions

Positions represent on-chain token holdings for a wallet. Querying positions does not require authentication - any wallet address can be looked up. All numeric values are already normalized (the 6-decimal division has been applied).

```typescript
import { PositionStatus, PlatformType } from '@prediktgg/sdk';

// Minimal - all positions for a wallet
const result = await sdk.positions.list({
  userAddress: '7xKXtg2CW87d97TXJSDpxFnR3ys1',
});

// Full - with all filters
const result = await sdk.positions.list({
  userAddress: '7xKXtg2CW87d97TXJSDpxFnR3ys1',
  status: PositionStatus.OPEN,
  source: PlatformType.POLYMARKET,
  winner: true,
  marketId: 'market-id-abc',
  search: 'bitcoin',
  page: 1,
  limit: 20,
});

console.log(result.data.positions);        // PositionResponse[]
console.log(result.pagination.totalItems);
```

**Parameters - `PositionsQuery`:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userAddress` | `string` | Yes | Wallet address to query positions for |
| `status` | `PositionStatus` | No | Filter to `OPEN` or `CLOSED` positions |
| `source` | `PlatformType` | No | Filter to a specific platform |
| `winner` | `boolean` | No | `true` to return only winning positions, `false` for losing only |
| `marketId` | `string` | No | Filter to positions within a specific market |
| `search` | `string` | No | Full-text search on market title |
| `page` | `number` | No | Page number, 1-indexed |
| `limit` | `number` | No | Items per page |

### Fetch a single position

```typescript
const position = await sdk.positions.get('position-id');
```

**Response - `PositionResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Position identifier |
| `marketId` | `string \| null` | The market this position is in |
| `ticker` | `string` | Market ticker |
| `source` | `PlatformType` | Platform the position is on |
| `outcome` | `Outcome` | YES or NO |
| `shares` | `number` | Number of position tokens held (already normalized from 6 decimals) |
| `averageCost` | `number` | Average purchase price per share in USD |
| `totalCost` | `number` | Total USD spent to acquire this position |
| `value` | `number \| null` | Current market value in USD based on live prices - `null` if market data is unavailable |
| `pnl` | `number \| null` | Lifetime profit/loss as a percentage - `null` until value is available |
| `status` | `PositionStatus` | `OPEN` or `CLOSED` |
| `isWinner` | `boolean \| null` | `null` until the market determines an outcome; `true` if the held outcome won |
| `openedAt` | `string` | ISO 8601 timestamp of first buy |
| `closedAt` | `string \| null` | ISO 8601 timestamp when the position was fully closed or redeemed |
| `market` | `PositionMarket \| null` | Embedded market details (title, rules, status, prices) - `null` if the market record is missing |

---

## Price History

Price history provides time-series data for market prices. Each data point is a `{ t, p }` pair where `t` is a Unix timestamp in seconds and `p` is the price in cents (0-100). A price of `65` means 65¢ or 0.65 per contract.

### Price history for a single market

Fetches YES and NO price series for one specific platform market.

```typescript
// Minimal - full price history at default fidelity
const history = await sdk.priceHistory.forMarket('market-id-abc');

// Full - scoped time window with controlled point count
const history = await sdk.priceHistory.forMarket('market-id-abc', {
  interval: '1d',
  fidelity: 200,
  startTs: 1700000000,
  endTs: 1710000000,
});

console.log(history.marketId);
console.log(history.platform);
console.log(history.title);
console.log(history.yes);  // PricePoint[] - YES price over time
console.log(history.no);   // PricePoint[] - NO price over time
```

**Parameters - `PriceHistoryParams` (all optional):**

| Parameter | Type | Description |
|-----------|------|-------------|
| `interval` | `'1h' \| '6h' \| '1d' \| '1w' \| '1m' \| 'max'` | Time window to show. `max` returns the full history. Defaults to `max` |
| `fidelity` | `number` | Maximum number of data points to return. The server downsamples when the raw series exceeds this number |
| `startTs` | `number` | Unix timestamp (seconds) to start the series from |
| `endTs` | `number` | Unix timestamp (seconds) to end the series at |

### Price history for a matched market group

Fetches price series for all constituent markets in a cross-platform matched group in a single call. Useful for rendering comparison charts across platforms.

```typescript
// Minimal
const result = await sdk.priceHistory.forMatchedMarket('matched-market-id-xyz');

// With interval
const result = await sdk.priceHistory.forMatchedMarket('matched-market-id-xyz', {
  interval: '1w',
  fidelity: 150,
});

result.markets.forEach((market) => {
  console.log(market.platform);  // which platform
  console.log(market.yes);       // PricePoint[]
  console.log(market.no);        // PricePoint[]
});

// Some platforms may fail to return data - they are listed here instead of throwing
result.errors.forEach((e) => {
  console.warn(`${e.platform}: ${e.error}`);
});
```

**Response - `MatchedMarketPriceHistoryResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `matchedMarketId` | `string` | The matched-market group ID |
| `markets` | `MarketPriceHistory[]` | Successfully fetched price series, one per platform market |
| `errors` | `PriceHistoryError[]` | Platforms that failed to return data - contains `platform`, `title`, and `error` message |

---

## WebSocket

The WebSocket client provides real-time market updates. It is completely independent from the HTTP client - no API key or JWT is sent, and it can be used without authentication.

The intended usage pattern is: **subscribe to the market IDs currently visible in the UI**. When the user is viewing a table of markets (e.g. page 1 of results), subscribe to those market IDs so their prices update in real time. When the user navigates to a different page or applies a filter, subscribe to the new set of visible market IDs. The `set_subscriptions` action always replaces the full subscription list, not adds to it, so you can call `subscribe()` freely as the visible set changes.

### Connect

```typescript
sdk.ws.connect('wss://ws.predikt.xyz');
```

### Subscribe to market IDs

Pass an array of market IDs to receive updates for. This call replaces any previous subscription. Typically called after the connection opens and again whenever the displayed market list changes.

```typescript
sdk.ws.on('open', () => {
  // Subscribe to the markets currently visible in the table
  const visibleMarketIds = currentPageMarkets.flatMap((group) =>
    group.markets.map((m) => m.id)
  );
  sdk.ws.subscribe(visibleMarketIds);
});

// When the user navigates to a different page, update subscriptions
function onPageChange(newMarkets: MarketGroupDto[]) {
  const newIds = newMarkets.flatMap((group) => group.markets.map((m) => m.id));
  sdk.ws.subscribe(newIds);  // replaces the previous subscription list
}
```

### Listen for market updates

The server sends a `market_update` event whenever any field on a subscribed market changes. Each event carries the exact fields that changed and their old and new values, so you can update only what changed in your UI state.

```typescript
sdk.ws.on('market_update', (event) => {
  console.log(event.marketId);         // which market changed
  console.log(event.matchedMarketId);  // null if not part of a matched group
  console.log(event.timestamp);        // unix milliseconds

  event.changes.forEach((change) => {
    // e.g. { field: 'yesAsk', oldValue: 0.52, newValue: 0.55 }
    console.log(change.field, change.oldValue, change.newValue);
  });
});
```

**`MarketUpdateEvent` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | `string` | The market that changed |
| `matchedMarketId` | `string \| null` | The matched-market group this market belongs to, if any |
| `changes` | `MarketFieldChange[]` | Array of changed fields with `field`, `oldValue`, and `newValue` |
| `timestamp` | `number` | Unix millisecond timestamp of the update |

Commonly updated fields include `yesAsk`, `yesBid`, `noAsk`, `noBid`, `volume`, and `liquidity`.

### Connection lifecycle events

```typescript
sdk.ws.on('open',  () => console.log('Connected'));
sdk.ws.on('close', () => console.log('Disconnected - will reconnect once automatically'));
sdk.ws.on('error', (err: Error) => console.error('WebSocket error:', err.message));
```

### Ping / pong

Use ping to verify the connection is alive before subscribing or sending commands.

```typescript
sdk.ws.ping();
sdk.ws.on('pong', () => console.log('Server responded'));
```

### Remove a listener

```typescript
const handler = (event: MarketUpdateEvent) => { /* ... */ };
sdk.ws.on('market_update', handler);

// Later - remove this specific handler without affecting others
sdk.ws.off('market_update', handler);
```

### Disconnect

```typescript
sdk.ws.disconnect();
```

**Reconnection:** If the connection drops unexpectedly (e.g. network blip), the client automatically reconnects once after 2 seconds. After reconnecting, re-subscribe because the server does not retain subscriptions across connections. Calling `disconnect()` explicitly cancels the reconnect.

```typescript
sdk.ws.on('open', () => {
  // Re-subscribe after automatic reconnect too
  sdk.ws.subscribe(currentVisibleMarketIds);
});
```

---

## Users

The users module currently exposes referral information for the authenticated user.

```typescript
const referral = await sdk.users.getReferralInfo();

console.log(referral.referralCode);    // share this code with others to earn rewards
console.log(referral.referredByCode);  // null if the account was not created via a referral
console.log(referral.referralCount);   // number of accounts that used this code to sign up
```

---

## Direct Trading and Polymarket Combos (server-side)

These namespaces let your backend trade Polymarket on your users' **Privy wallets**: regular markets (`sdk.trading`) and **Polymarket Combos**, Polymarket's parlays (`sdk.combos`). Predikt signs trades through Privy, within limits you approve once per wallet.

> **Server-side only.** Every endpoint below requires a **backend** API key (`sk_predikt_...`); a frontend key gets `403`. Never ship the API key, your Privy App Secret or your owner key to a browser or app.

Some terms used below:

| Term | Meaning |
|---|---|
| Privy wallet | An EOA you create in Privy with `owner_id` = your **owner key**. It signs for the Deposit Wallet and never holds trading funds. |
| Deposit Wallet | Polymarket's smart contract wallet for that Privy wallet (`depositWalletAddress`, also `tradingAddress`). It holds pUSD and positions. **Users fund this address.** |
| Grant | What you approve for Predikt: `maxBuyAmountPerOrder` and `expiresAt`, for `buy`, `sell`, `redeem` and `cancel`. Combos use the same grant. |
| Owner key | Your P-256 Privy authorization key. It never leaves your server; you sign approvals with it locally. |

**Units.** pUSD amounts and shares are strings in 6-decimal base units (`"2000000"` = 2 pUSD or 2 shares). Prices are decimal strings (`"0.37"`). Never convert base units to a JS `number`; use `toBaseUnits` / `fromBaseUnits`:

```typescript
import { toBaseUnits, fromBaseUnits } from '@prediktgg/sdk';

toBaseUnits('2.5');        // "2500000" (throws on more than 6 decimals)
fromBaseUnits('5054026');  // "5.054026"
```

**Idempotency is mandatory on every write**: `idempotencyKey` (direct trading, 8–128 chars `[A-Za-z0-9_-]`) or `clientOrderId` (combos, 1–100 chars). Store the key with your own order before calling. Repeating a request with the same key never trades twice. After an order ends `rejected` / `FAILED`, use a **new** key. Never send a new key while an order's outcome is still unknown.

### Setup

```typescript
import { PrediktSDK } from '@prediktgg/sdk';

const sdk = new PrediktSDK({
  baseUrl: process.env.PREDIKT_API_URL!,
  apiKey: process.env.PREDIKT_API_KEY!,  // backend key
  timeoutMs: 60_000,                     // optional; no timeout by default
  // retry: { maxRetries: 2, approvalsPendingDelayMs: 15_000 }  // defaults; `false` disables
});
```

Calls on `privyApp`, `accounts`, `trading` and `combos` are all idempotent, so the SDK **retries them automatically with the same request** (same key) on:

- network errors and timeouts, and `5xx` errors with `details.retryable: true` and no `details.orderId` (exponential backoff, 2 retries by default). A `5xx` that names a recorded order (`err.orderId`) is returned to you: no funds moved, so check that order and use a **new** key;
- `409 TRADING_APPROVALS_PENDING`: one-time approvals were submitted on the wallet's first trade but are not confirmed yet (waits 15 s, 3 retries by default). For combos nothing is recorded before this error, so the repeat completes the order. A direct order is already recorded as `rejected` at that point, so the repeat returns that `rejected` order (`reasonCode: TRADING_APPROVALS_PENDING`): place it again with a **new** `idempotencyKey`.

It never retries other `4xx` errors, `429`, or the older `buy` / `sell` / `redeem` endpoints.

### 1. Connect your Privy app (once)

Before this, Predikt must have your Privy **App Secret** configured (sent through the agreed secure channel). Until then calls fail with `500 INTERNAL_ERROR` (`PrediktInternalError`).

```typescript
await sdk.privyApp.connect({ appId: process.env.PRIVY_APP_ID!, environment: 'production' });
await sdk.privyApp.get();  // { appId, environment, status: 'active' }
```

### 2. Register a wallet and approve Predikt

Create the Privy wallet with `owner_id` = your owner key quorum, then:

```typescript
import { verifyAndSignApproval } from '@prediktgg/sdk/server';

const limits = { maxBuyAmountPerOrder: '10000000', expiresAt: '2026-12-15T12:00:00Z' };

// Deploys the Deposit Wallet if needed; the SDK repeats the request while it is `provisioning`.
const pending = await sdk.accounts.register({ privyWalletId, ...limits });

if (pending.status === 'awaiting_owner_approval') {
  // Checks the approval against Privy (not Predikt), then signs it locally with your owner key.
  const signed = await verifyAndSignApproval(pending, {
    ownerKey: process.env.PRIVY_OWNER_KEY!,          // base64 PKCS#8 ("wallet-auth:..." is fine) or PEM
    privyAppId: process.env.PRIVY_APP_ID!,
    privyAppSecret: process.env.PRIVY_APP_SECRET!,
    expected: { privyWalletId, ...limits },
  });
  const account = await sdk.accounts.activate(pending, signed);  // status: 'active'
}
```

The returned `TradingAccount` carries both identifiers, `accountId` (direct trading) and `depositWalletAddress` (combos). Every method below accepts it in place of the raw ID or address. Store both.

| `status` | Meaning | Next step |
|---|---|---|
| `provisioning` | Deposit Wallet still deploying (returned only if `register` stopped waiting, after 2 min by default) | Call `register` again with the same input |
| `awaiting_owner_approval` | `approval` is ready (valid 10 minutes). With `activeGrant` set it is a pending re-authorization and the account still trades | `verifyAndSignApproval`, then `activate` |
| `active` | Tradable | Done |
| `unavailable` | Grant expired, or account suspended | `reauthorize` (expired grants only; a suspended account needs Predikt) |

`verifyAndSignApproval` is imported from **`@prediktgg/sdk/server`** (Node only; it uses `node:crypto`). It refuses to sign, with an `ApprovalVerificationError` whose `code` names the failed check, unless all of these hold:

1. `approvalDigest` is the SHA-256 of the RFC 8785 canonical JSON of `signaturePayload`. The approval, and the signed request's `privy-request-expiry`, expire within 15 minutes, so the signed update cannot be replayed later.
2. The payload is a `PATCH` of exactly your wallet in your Privy app that changes only `additional_signers`.
3. Per Privy's current wallet: the owner is unchanged, every other signer is kept unchanged, no signer except Predikt's is added, and Predikt's signer gets exactly `[policyId]`.
4. Per Privy's policy: it is owned by the wallet owner, and **every rule is exactly one of Predikt's reviewed rules** (policy profile v4, the same shapes the backend's own policy checker accepts): Polymarket CLOB login for this wallet's address, orders on the Polymarket CTF, NegRisk CTF or Exchange v3 contracts, or batches of this Deposit Wallet. All of them are typed-data signing only (`eth_signTypedData_v4`), on Polygon, and expire (`current_unix_timestamp lt`) no later than your `expiresAt`. Any other rule, condition or field is refused.
5. The stated buy cap and expiry are not above what you asked for.

Optional pins in `expected` make it stricter: `ownerId` (your owner key quorum), `delegatedSignerId` (Predikt's signer ID, e.g. from your first approval) and `depositWalletAddress`. A new policy profile on Predikt's side needs a matching SDK release; until then this function refuses to sign.

The signature is ECDSA P-256 / SHA-256 over the canonical JSON, DER-encoded, base64. The owner key is used only for that and is never logged, stored or sent.

What you approve: until `expiresAt`, Predikt can sign Polymarket logins and orders, and **Deposit Wallet batches with unrestricted inner calls** (needed for approvals, redemptions and withdrawals; Predikt only ever sends withdrawals to your own Privy wallet, but that limit is enforced by Predikt, not by the policy). Treat the grant as broad control of the Deposit Wallet's funds for its duration. The buy cap is enforced by Predikt, not by the Privy policy. You remain the owner: removing Predikt's signer from the wallet in Privy revokes access immediately (there is no revoke endpoint).

### 3. Re-authorize (change limits, renew, enable combos)

```typescript
const next = { maxBuyAmountPerOrder: '20000000', expiresAt: '2027-01-15T12:00:00Z' };
const pending = await sdk.accounts.reauthorize(account, next);
const signed = await verifyAndSignApproval(pending, { ownerKey, privyAppId, privyAppSecret, expected: { privyWalletId, ...next } });
await sdk.accounts.activate(pending, signed);
```

- Use it to change limits, to renew before `expiresAt` (also works after expiry), and **once for accounts approved before Exchange v3 was added (policy v3)**. Those still trade regular markets but cannot sign combos: combo orders end `FAILED` / `SIGNING_FAILED`. `account.activeGrant.combosEnabled` tells you in advance: `true` = combos work; `null` = unknown (approved before the API recorded policy profiles) or `false` = reauthorize once.
- **Trading continues under the old grant until activation.** While a re-authorization is pending, `accounts.get` returns `awaiting_owner_approval` with `activeGrant` set to the limits it still trades under (`activeGrant` is `null` for a first registration, after expiry and for suspended accounts). Use `isReauthorizationPending(account)` rather than the status alone:

```typescript
import { isReauthorizationPending } from '@prediktgg/sdk';

const account = await sdk.accounts.get(accountId);
account.activeGrant;                 // { maxBuyAmountPerOrder, expiresAt, policyProfile, combosEnabled } | null
isReauthorizationPending(account);   // true: new limits await your signature, old ones still apply
```
- Same limits again returns the same pending approval; different limits replace an unsigned one. `409 TRADING_AUTHORIZATION_APPROVAL_IN_PROGRESS`: finish the pending activation first.

### 4. Balances and positions

```typescript
const portfolio = await sdk.accounts.portfolio(account);
portfolio.tradingAddress;   // the Deposit Wallet: users send pUSD on Polygon here
portfolio.balances.pusd;    // tradable, exact on-chain
portfolio.balances.usdce;   // USDC.e sent by mistake (not tradable until wrapped)
portfolio.positions;        // regular positions; null (with positionsError) if Polymarket's service is down

const { markets } = await sdk.accounts.redeemable(account);  // resolved markets with exact payouts
```

Combo positions are not in the portfolio; use `sdk.combos.positions`.

**Withdraw.** Moves pUSD from the Deposit Wallet to the account's own **Privy wallet**, the only possible destination (it cannot be set in the request). From there you move the funds with Privy as usual.

```typescript
const withdrawal = await sdk.trading.withdraw(account, {
  amount: '5000000',                     // base units, or 'all' for the whole balance
  idempotencyKey: 'casino-withdraw-0001',
});
const done = await sdk.trading.waitForOrder(account, withdrawal);
// done.side === 'withdraw'; 'withdrawn' → done.amount is the exact pUSD moved, done.transactionHashes the transfer
```

- No fees: Polymarket's relayer pays the gas. Any active, unexpired grant allows withdrawals.
- Before anything is submitted: `400 NOTHING_TO_WITHDRAW` (no pUSD) or `400 INSUFFICIENT_BALANCE` (`amount` above the balance). `409 WITHDRAWAL_REJECTED`: the relayer refused, nothing moved. A submitted transfer that reverted ends `rejected` with `reasonCode: WITHDRAWAL_FAILED`.
- Do not withdraw funds reserved for orders that are still `submitted` or `unknown`.

### 5. Trading regular markets

Orders are **fill-or-kill**: fully filled at or better than the limit price, or nothing.

```typescript
const buy = await sdk.trading.buy(account, {
  tokenId,                        // Polymarket outcome token ID
  amount: '2000000',              // all-in pUSD budget incl. Polymarket's fee; ≤ maxBuyAmountPerOrder
  slippagePercent: '5',           // optional, 0.1–50, default 5: limit = best ask × (1 + 5%)
  idempotencyKey: 'casino-order-0001',
});

const sell = await sdk.trading.sell(account, {
  tokenId,
  shares: 'all',                  // base units or "all"; Polymarket's minimum is usually 5 shares
  idempotencyKey: 'casino-order-0002',
});

// Fallback only: Polymarket usually redeems resolved positions on its own.
const redemption = await sdk.trading.redeem(account, { conditionId, idempotencyKey: 'casino-redeem-0001' });
```

| `status` | Final | Funds moved | What to do |
|---|---|---|---|
| `filled` | yes, once amounts are set | yes | Settle: debit `spentAmount` (buy), credit `receivedAmount` (sell) |
| `redeemed` | yes | yes | Credit `receivedAmount` |
| `withdrawn` | yes | yes | Withdrawal settled: `amount` pUSD is in your Privy wallet |
| `rejected` | yes | no | Release the reservation; retry with a **new** key if wanted (`reasonCode` says why) |
| `pending`, `submitting`, `submitted` | no | pending | Keep funds reserved; poll |
| `unknown` | no | maybe | Keep funds reserved; poll; **never** place a replacement order |

A `filled` order can have `null` amounts for a few seconds. `waitForOrder` polls until the order is final (`isDirectOrderFinal`):

```typescript
// Transient poll failures (network, 429, 5xx) are skipped, not thrown.
const settled = await sdk.trading.waitForOrder(account, buy, { timeoutMs: 120_000 });
if (settled.status === 'filled') debitUser(settled.spentAmount!);
else if (settled.status === 'rejected') releaseReservation();
else keepReservedAndPollLater(settled);  // a timeout is NOT a failure
```

Predikt reconciles `submitted` / `unknown` orders against the chain: first after about 10 minutes, then at growing intervals up to hourly. No settlement after an hour → `rejected` (`NOT_FILLED_ONCHAIN`). Unresolved after 24 hours → `reasonCode: RECONCILE_EXHAUSTED` (manual review; keep it pending).

**Order change feed.** Automatic redemptions by Polymarket (`side: 'redeem'`, `source: 'polymarket_auto'`) appear only here, within about 10 minutes. Store the cursor and poll:

```typescript
let cursor = await loadCursor(account.accountId);
for await (const page of sdk.trading.iterateOrderChanges(account, { cursor })) {
  for (const order of page.orders) await applyOnce(order);  // the same order can appear again
  if (page.nextCursor) await saveCursor(account.accountId, (cursor = page.nextCursor));
}
```

Filters: `side` (`buy | sell | redeem | withdraw`), `source` (`integrator | polymarket_auto`), `limit` 1–100. Single page: `sdk.trading.listOrderChanges(account, query)`. Single order: `sdk.trading.getOrder(account, orderId)`.

### 6. Polymarket Combos

A combo is one ticket over 2–50 legs (a market and an outcome). It pays 1 pUSD per share only if **every** leg wins (a voided leg can produce a partial payout). Prices come from market makers through an RFQ. The account must have an active, unexpired **policy-v4** grant: check `account.activeGrant?.combosEnabled === true`, and reauthorize once if it is `null` or `false` (see re-authorize above). Polymarket allows **15 RFQs per minute per wallet** (`429` above that; back off).

```typescript
import type { ComboLeg } from '@prediktgg/sdk';

// Eligible markets (ordered by volume). `outcomes`, `prices`, `positionIds` align by index.
const { markets, nextCursor } = await sdk.combos.listMarkets({ limit: 50 });
for await (const market of sdk.combos.iterateMarkets()) { /* every market */ }

const legs: ComboLeg[] = [
  { marketId: '682708', outcome: 0 },   // 0 = first outcome (usually Yes)
  { marketId: '1090496', outcome: 1 },
];

// Indicative price (product of leg prices). Real quotes are usually a bit higher.
const quote = await sdk.combos.quote({ legs, amount: '2000000' });

const order = await sdk.combos.buy({
  wallet: account,                      // or account.depositWalletAddress
  legs,
  amount: '2000000',                    // pUSD budget incl. fees; never exceeded
  maxPrice: '0.41',                     // max price per share incl. fees, e.g. indicative + 10%
  clientOrderId: 'casino-combo-0001',
});
// Waits ~15 s for the fill: FILLED, FAILED (see order.error.code) or EXECUTING.
const final = await sdk.combos.waitForOrder(order);
// Keep final.comboConditionId: it is needed to sell and redeem.
```

Cash out (only combos bought through Predikt) and the redemption fallback:

```typescript
await sdk.combos.sell({
  wallet: account,
  comboConditionId: final.comboConditionId!,
  shares: final.shares!,                // base units
  minPrice: '0.30',                     // min net price per share after fees
  clientOrderId: 'casino-combo-sell-0001',
  allowPartialFill: false,              // default
});

// Normally Polymarket pays out resolved combos automatically (see accounting below).
await sdk.combos.redeem({ wallet: account, comboConditionId, clientOrderId: 'casino-combo-redeem-0001' });
```

Market makers round to 2 decimals, so a "full" cash-out can leave ~0.008 shares. Very small sells can get `INVALID_RFQ`.

**`clientOrderId` reuse.** Keys are unique per integrator across all combo orders (buys, sells, redemptions and automatic payouts). Repeating the same request returns the original order; reusing a key for a different request (direction, wallet, amount or shares, price limit, `allowPartialFill`, legs or combo) throws `PrediktConflictError` with code `COMBO_CLIENT_ORDER_ID_REUSED`, `details.orderId` (the existing order) and `details.mismatch`. Nothing is placed. Older API versions returned the existing order instead; the SDK compares it as well and throws the same error with `details.raisedBy: 'sdk'`.

| `status` | What to do |
|---|---|
| `PENDING` | Transient; poll |
| `EXECUTING` | Quote accepted (or redemption submitted), waiting for the chain. Keep funds reserved; poll `getOrder`. Never place a replacement |
| `FILLED` | Done; amounts final. Settle with the user |
| `FAILED` | Nothing traded; `error.code` says why. Release funds; retry with a **new** `clientOrderId` if wanted |

Common `FAILED` codes: `NO_QUOTES` (no maker quoted; often succeeds a minute later), `PRICE_ABOVE_MAX` / `PRICE_BELOW_MIN`, `QUOTE_EXPIRED`, `SIGNING_FAILED` (policy v3, signer removed, grant expired or buy above the cap), Polymarket codes such as `CONTRADICTORY_LEGS`, `SIZE_TOO_LARGE`, `INVALID_RFQ`, and for redemptions `COMBO_ALREADY_REDEEMED`, `COMBO_REDEMPTION_REJECTED`, `COMBO_REDEMPTION_FAILED`. Quotes succeed more often with legs priced ~0.4–0.6 from unrelated events; avoid lottery legs (< ~0.02) and near-certain tickets (> ~0.85).

Reads:

```typescript
await sdk.combos.getOrder(id);
await sdk.combos.listOrders({ wallet: account, status: 'FILLED', limit: 20, offset: 0 });  // newest first
for await (const o of sdk.combos.iterateOrders({ wallet: account })) { /* all pages */ }

// Polymarket data API, passed through unchanged (snake_case):
await sdk.combos.positions({ wallet: account, status: 'REDEEMABLE' });
await sdk.combos.activity({ wallet: account });   // not for accounting: no cash-outs, float amounts
```

`listOrders` is **not** a change feed: an existing order's status change does not move it. Poll pending orders with `getOrder`; detect new automatic payouts by listing and processing ids you have not seen.

### 7. Payout accounting

Process each order ID exactly once.

| Event | Source of truth |
|---|---|
| Direct buy debit | `spentAmount` of the `filled` buy |
| Direct sell credit | `receivedAmount` of the `filled` sell |
| Direct payout | `receivedAmount` of `redeemed` orders, **both** `source` values (`integrator`, `polymarket_auto`) |
| Withdrawal | `amount` of the `withdrawn` withdraw order |
| Combo buy debit | `amount` of the `FILLED` BUY |
| Combo cash-out credit | `amount` of the `FILLED` SELL |
| Combo payout | `amount` of `FILLED` REDEEM orders, **both** sources (`API`, `POLYMARKET_AUTO`) |

Automatic payouts: Polymarket redeems resolved positions on its own. Predikt records each as an order: direct `side: 'redeem'`, `source: 'polymarket_auto'` (in `iterateOrderChanges`); combos `direction: 'REDEEM'`, `source: 'POLYMARKET_AUTO'`, `clientOrderId: 'polymarket-auto:<txHash>'` (in `listOrders`, scanned every 10 minutes). If your own redeem loses the race: direct ends `rejected` with `REDEEMED_BY_POLYMARKET`, combos end `FAILED` with `COMBO_ALREADY_REDEEMED`; the payout is on the automatic order.

### 8. Error codes

All errors are `PrediktApiError` subclasses (see [Error Handling](#error-handling)); branch on `code`. Errors raised after an order was recorded carry `details.orderId` (`err.orderId`); provider outages carry `details.retryable` (`err.retryable`).

| Code | Meaning |
|---|---|
| `PRIVY_APP_NOT_CONNECTED` | Call `privyApp.connect` first |
| `PRIVY_APP_ALREADY_CONNECTED` | A different Privy app is connected (one per integrator) |
| `PRIVY_SETUP_OWNER_REQUIRED`, `PRIVY_SETUP_OWNER_UNSUPPORTED` | The wallet needs your owner key as `owner_id` |
| `TRADING_ACCOUNT_PROVISIONING_FAILED` | Deposit Wallet setup failed (reason in the message) |
| `TRADING_AUTHORIZATION_EXISTS` | Different limits on an existing grant: use `reauthorize` |
| `TRADING_AUTHORIZATION_APPROVAL_IN_PROGRESS` | Finish the pending activation first |
| `AUTHORIZATION_SETUP_APPROVAL_EXPIRED`, `AUTHORIZATION_SETUP_APPROVAL_CHANGED` | Request a fresh approval and sign it |
| `PRIVY_SETUP_REJECTED` | Privy rejected the signature (wrong key or modified payload) |
| `TRADING_ACCOUNT_NOT_AWAITING_APPROVAL` | Nothing to activate |
| `TRADING_AUTHORIZATION_NOT_ACTIVE`, `TRADING_AUTHORIZATION_EXPIRED` (403) | No active grant: `reauthorize` |
| `IDEMPOTENCY_KEY_REUSED` (409) | Same direct `idempotencyKey`, different order |
| `SLIPPAGE_OUT_OF_RANGE`, `BUY_AUTHORIZATION_CAP_EXCEEDED`, `BUY_BUDGET_EXCEEDED`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_SHARES`, `ORDER_TOO_SMALL` (400) | Bad direct order input |
| `INSUFFICIENT_LIQUIDITY` (409) | Empty side of the book |
| `PRIVY_SIGNING_DENIED` (403) | Policy refused: signer removed or policy changed |
| `EXECUTION_AUTHORIZATION_CHANGED` (409) | Grant changed during preparation; retry |
| `MARKET_NOT_RESOLVED` (409), `NOTHING_TO_REDEEM` (400), `REDEMPTION_REJECTED` (409) | Direct redeem |
| `NOTHING_TO_WITHDRAW` (400), `INSUFFICIENT_BALANCE` (400), `WITHDRAWAL_REJECTED` (409) | Withdraw |
| `INVALID_CURSOR` (400) | Bad change-feed cursor |
| `TRADING_APPROVALS_PENDING` (409) | First-trade approvals not confirmed yet (retried automatically) |
| `COMBO_WALLET_NOT_ALLOWED` (403) | Wallet is not an active trading account of yours |
| `COMBO_INVALID_AMOUNT`, `COMBO_INVALID_PRICE`, `COMBO_DUPLICATE_MARKET`, `COMBO_MARKET_NOT_FOUND`, `COMBO_MARKET_NOT_ENABLED` (400) | Bad combo input or legs |
| `COMBO_POSITION_NOT_FOUND` (404) | Sell/redeem without a filled buy through Predikt |
| `COMBO_NOT_REDEEMABLE` (409) | Not all legs resolved yet, or already paid out |
| `COMBO_ORDER_NOT_FOUND` (404) | Unknown combo order ID |
| `COMBO_CLIENT_ORDER_ID_REUSED` (409) | `clientOrderId` belongs to a different combo order (`details.orderId`, `details.mismatch`) |
| `PRIVY_SIGNING_UNAVAILABLE`, `CLOB_CREDENTIALS_UNAVAILABLE`, `TRADING_APPROVALS_FAILED`, `POLYMARKET_RATE_LIMITED`, `POSITIONS_UNAVAILABLE` (503) | Provider issue on direct trading; see `retryable` |
| `INTERNAL_ERROR` (500) | Unexpected failure. Also returned when your Privy App Secret is not configured yet, and on combo calls while Polymarket's market or data API is unavailable (retry later). With `err.orderId`, check that order first |

### 9. Testing

- `npm test`: unit tests;
- `npm run test:contract`: the built SDK against the backend's real controllers, validation and mappers (needs the backend checkout next to this repo, or `BACKEND_DIR`);
- `npm pack --dry-run`: package check before publishing;
- `scripts/e2e-checklist.mjs`: end-to-end checklist against the real API with a test Privy wallet. Copy `e2e.env.example` to `e2e.env`, fill it in, then `npm run build && node --env-file=e2e.env scripts/e2e-checklist.mjs`. It spends real funds **only** with `E2E_TRADE=1`; the script header lists every option.

---

## Error Handling

All HTTP errors throw a subclass of `PrediktApiError`. The SDK maps each HTTP status to a dedicated typed class, so you can catch errors either broadly (any API error) or precisely (a specific status category). Every error carries a `code` string — a machine-readable identifier from the aggregator that lets you branch on the exact failure reason without parsing message text.

### Error classes

| Class | Status | When thrown |
|-------|--------|-------------|
| `PrediktValidationError` | `400` | Request failed validation - bad parameters, invalid state |
| `PrediktAuthError` | `401` or `403` | Not authenticated, token expired, or action is forbidden |
| `PrediktNotFoundError` | `404` | Requested resource does not exist |
| `PrediktConflictError` | `409` | Conflict with current state (e.g. item already exists) |
| `PrediktRateLimitError` | `429` | Rate limit exceeded; `retryAfter` holds the `Retry-After` seconds when sent |
| `PrediktInternalError` | `500` | Server-side failure |
| `PrediktServiceUnavailableError` | `503` | A provider (Privy, Polymarket) is unavailable; check `retryable` |
| `PrediktApiError` | any other | Base class - also the fallback for unlisted status codes |

All subclasses extend `PrediktApiError`, so catching the base class still catches everything.

### Error properties

Every error exposes these properties:

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code (`statusCode` is an alias) |
| `message` | `string` | Human-readable description of what went wrong |
| `code` | `string \| undefined` | Machine-readable error code from the aggregator (e.g. `ORDER_NOT_FOUND`) - present on all errors originating from the Predikt API |
| `details` | `PrediktErrorDetails \| undefined` | Extra fields some errors carry, e.g. `{ orderId, retryable }` |
| `orderId` | `string \| undefined` | `details.orderId`: an order recorded before the error. Poll it instead of placing a new one |
| `retryable` | `boolean \| undefined` | `details.retryable`: whether repeating the same request may succeed |

### Catching by type

```typescript
import {
  PrediktApiError,
  PrediktAuthError,
  PrediktNotFoundError,
  PrediktValidationError,
  PrediktConflictError,
  PrediktInternalError,
} from '@prediktgg/sdk';

try {
  await sdk.buy.createOrder({ ... });
} catch (err) {
  if (err instanceof PrediktAuthError) {
    // status 401 or 403
    // err.status === 401 means token expired; 403 means forbidden
    sdk.clearToken();
    await reauthenticate();

  } else if (err instanceof PrediktNotFoundError) {
    // status 404
    console.warn('Resource not found:', err.message);

  } else if (err instanceof PrediktValidationError) {
    // status 400
    console.warn('Bad request:', err.message);

  } else if (err instanceof PrediktInternalError) {
    // status 500
    console.error('Server error - try again later');

  } else if (err instanceof PrediktApiError) {
    // any other HTTP error
    console.error(`HTTP ${err.status}:`, err.message);

  } else {
    throw err; // re-throw non-API errors
  }
}
```

### Branching on error code

When multiple failures share the same HTTP status, use `code` to distinguish them:

```typescript
import { PrediktNotFoundError, PrediktValidationError } from '@prediktgg/sdk';

try {
  await sdk.orders.getBuyOrder(orderId);
} catch (err) {
  if (err instanceof PrediktNotFoundError) {
    switch (err.code) {
      case 'ORDER_NOT_FOUND':
        // order was never created or already purged
        break;
      case 'BATCH_NOT_FOUND':
        // batch reference is stale
        break;
    }
  }

  if (err instanceof PrediktValidationError) {
    switch (err.code) {
      case 'ORDER_NOT_IN_PENDING_STATUS':
        // tried to set tx hash on an order that already progressed
        break;
      case 'NO_ASK_LIQUIDITY':
        // market has no sell-side liquidity at the moment
        break;
      case 'BATCH_SIZE_EXCEEDED':
        // too many orders in a single batch call
        break;
    }
  }
}
```

### Common error codes

The aggregator returns these codes in the `code` field:

**Auth (401 / 403)**

| Code | Description |
|------|-------------|
| `AUTH_TOKEN_INVALID` | JWT is missing, malformed, or expired |
| `ORDER_FORBIDDEN` | Authenticated user does not own this order |
| `BATCH_FORBIDDEN` | Authenticated user does not own this batch |

**Not found (404)**

| Code | Description |
|------|-------------|
| `BUY_ORDER_NOT_FOUND` | Buy order with that ID does not exist |
| `SELL_ORDER_NOT_FOUND` | Sell order with that ID does not exist |
| `REDEEM_ORDER_NOT_FOUND` | Redeem order with that ID does not exist |
| `BATCH_NOT_FOUND` | Batch with that ID does not exist |
| `BRIDGE_TX_NOT_FOUND` | Bridge transaction reference not found |

**Validation (400)**

| Code | Description |
|------|-------------|
| `ORDER_NOT_IN_PENDING_STATUS` | Order has already progressed past `PENDING` |
| `NO_ASK_LIQUIDITY` | No sell-side liquidity available on this market |
| `NO_POSITION_TOKENS` | Wallet holds no position tokens for this market |
| `POSITION_AMOUNT_INVALID` | Position amount is zero or exceeds held balance |
| `SELL_ORDER_ALREADY_ACTIVE` | An open sell order for this position already exists |
| `BATCH_SIZE_EXCEEDED` | Batch contains more orders than the allowed maximum |
| `BATCH_DUPLICATE_POSITION` | Same position appears more than once in a batch |
| `BATCH_NO_PENDING_ORDERS` | All orders in the batch have already been processed |
| `ORDER_ALREADY_HAS_BRIDGE_TX` | `setTxHash` called on an order that already has a tx registered |

**Conflict (409)**

| Code | Description |
|------|-------------|
| `MARKET_IS_ALREADY_IN_FAVORITES` | Market is already in the user's favorites list |

**Server error (500)**

| Code | Description |
|------|-------------|
| `INTERNAL_ERROR` | Generic server-side failure - safe to retry after a short delay |

### Catching all API errors

If you only need to distinguish API errors from unexpected throws, catching the base class is sufficient:

```typescript
import { PrediktApiError } from '@prediktgg/sdk';

try {
  await sdk.markets.addFavorite(marketId);
} catch (err) {
  if (err instanceof PrediktApiError) {
    console.error(`[${err.status}] ${err.code ?? 'UNKNOWN'}: ${err.message}`);
  } else {
    throw err;
  }
}
```

### Network errors

Errors where no HTTP response is received (DNS failure, connection refused) throw the native `TypeError` from `fetch` and are not wrapped in any `PrediktApiError` subclass; a `timeoutMs` timeout throws the native `TimeoutError`. Handle them separately if your environment requires it.

For `privyApp`, `accounts`, `trading` and `combos` calls the SDK first retries these errors itself with the same request (see [Direct Trading and Polymarket Combos](#setup)). If the error still reaches you after a write, the outcome is unknown: repeat the call with the **same** idempotency key or `clientOrderId`, never a new one.

---

## Type Reference

All types and enums are re-exported from the package root and can be imported directly.

### Enums

```typescript
import {
  WalletChain,       // SOLANA | SUI
  SourceChain,       // Mayan bridge chain IDs — SOLANA='1' | SUI='21'
  Outcome,           // YES=0 | NO=1
  PlatformType,      // POLYMARKET | KALSHI | LIMITLESS
  MarketCategory,    // SPORTS | POLITICS | CRYPTO | ECONOMICS | TECH_SCIENCE | OTHER
  MarketStatus,      // UNOPENED | OPEN | PAUSED | CLOSED | DETERMINED | SETTLED
  MarketSortOption,  // NEWEST | VOLUME | LIQUIDITY | CLOSING
  SortOrder,         // ASC | DESC
  BuyOrderStatus,    // PENDING | EXECUTING | SETTLED | FAILED
  SellOrderStatus,   // PENDING | EXECUTING | SOLD | BRIDGING | SETTLED | FAILED
  RedeemOrderStatus, // PENDING | EXECUTING | BRIDGING | SETTLED | FAILED
  PositionStatus,    // OPEN | CLOSED
  MarketMatchType,   // EXACT | RELATED
} from '@prediktgg/sdk';
```

### USDC amounts

All USDC values in request bodies and order/position responses use **6 decimal places**. Always use strings to avoid floating-point precision issues.

```
1 USDC   = "1000000"
10 USDC  = "10000000"
0.5 USDC = "500000"
```

To convert: `humanAmount * 1_000_000` to send, `rawAmount / 1_000_000` to display.

### Pagination

All paginated endpoints return a consistent wrapper:

```typescript
interface PaginatedResponse<T> {
  data: T;
  pagination: {
    currentPage: number;
    itemsPerPage: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

Endpoints that return paginated data: `markets.list()`, `markets.listFavorites()`, `markets.getWorldCup2026()`, `positions.list()`.
