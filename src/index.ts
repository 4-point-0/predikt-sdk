import { HttpClient } from './http-client.js';
import { AuthClient } from './modules/auth.js';
import { BuyClient } from './modules/buy.js';
import { CombosClient } from './modules/combos.js';
import { TradingClient } from './modules/direct-trading.js';
import { MarketsClient } from './modules/markets.js';
import { OrdersClient } from './modules/orders.js';
import { PositionsClient } from './modules/positions.js';
import { PriceHistoryClient } from './modules/price-history.js';
import { PrivyAppClient } from './modules/privy-app.js';
import { RedeemClient } from './modules/redeem.js';
import { SellClient } from './modules/sell.js';
import { AccountsClient } from './modules/trading-accounts.js';
import { UsersClient } from './modules/users.js';
import { VenuesClient } from './modules/venues.js';
import { WebSocketClient } from './modules/websocket.js';
import { resolveRetryPolicy, RetryOptions } from './utils/retry.js';

export interface PrediktSDKConfig {
  baseUrl: string;
  apiKey: string;
  /** Pre-set a JWT token (e.g. when restoring a session). */
  token?: string;
  /** Abort any request that has not completed after this many milliseconds. No timeout by default. */
  timeoutMs?: number;
  /**
   * Automatic retries for `privyApp`, `accounts`, `trading` and `combos` calls, which are all
   * idempotent (the same request is re-sent with the same key). `false` disables them.
   */
  retry?: RetryOptions | false;
}

export class PrediktSDK {
  readonly auth: AuthClient;
  readonly users: UsersClient;
  readonly markets: MarketsClient;
  readonly buy: BuyClient;
  readonly sell: SellClient;
  readonly redeem: RedeemClient;
  readonly orders: OrdersClient;
  readonly positions: PositionsClient;
  readonly priceHistory: PriceHistoryClient;
  readonly venues: VenuesClient;
  readonly ws: WebSocketClient;

  // Direct trading and Polymarket Combos on integrator-owned Privy wallets.
  // Server-side only: these endpoints require a backend API key.
  /** The integrator's Privy app (connect once). */
  readonly privyApp: PrivyAppClient;
  /** Trading accounts: register, approve, re-authorize, balances and positions. */
  readonly accounts: AccountsClient;
  /** Regular Polymarket markets: buy, sell, redeem, orders. */
  readonly trading: TradingClient;
  /** Polymarket Combos (parlays): markets, quotes, buy, cash out, redeem, orders. */
  readonly combos: CombosClient;

  private token: string | undefined;
  private readonly http: HttpClient;

  constructor(config: PrediktSDKConfig) {
    if (config.token) this.token = config.token;
    this.http = new HttpClient(config.baseUrl, config.apiKey, () => this.token, {
      timeoutMs: config.timeoutMs,
      retry: resolveRetryPolicy(config.retry),
    });

    this.auth = new AuthClient(this.http, (token) => { this.token = token; });
    this.users = new UsersClient(this.http);
    this.markets = new MarketsClient(this.http);
    this.buy = new BuyClient(this.http);
    this.sell = new SellClient(this.http);
    this.redeem = new RedeemClient(this.http);
    this.orders = new OrdersClient(this.http);
    this.positions = new PositionsClient(this.http);
    this.priceHistory = new PriceHistoryClient(this.http);
    this.venues = new VenuesClient(this.http);
    this.ws = new WebSocketClient();

    this.privyApp = new PrivyAppClient(this.http);
    this.accounts = new AccountsClient(this.http);
    this.trading = new TradingClient(this.http);
    this.combos = new CombosClient(this.http);
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  clearToken(): void {
    this.token = undefined;
  }
}

export {
  PrediktApiError,
  PrediktValidationError,
  PrediktAuthError,
  PrediktNotFoundError,
  PrediktConflictError,
  PrediktRateLimitError,
  PrediktInternalError,
  PrediktServiceUnavailableError,
} from './error.js';
export type { PrediktErrorDetails } from './error.js';
export type { RetryOptions } from './utils/retry.js';
export type { WaitForOrderOptions } from './utils/poll.js';
export { toBaseUnits, fromBaseUnits } from './utils/units.js';
export { isDirectOrderFinal, isComboOrderFinal, isReauthorizationPending } from './utils/order-status.js';
export * from './types/index.js';
