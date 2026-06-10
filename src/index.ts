import { HttpClient } from './http-client';
import { AuthClient } from './modules/auth';
import { BuyClient } from './modules/buy';
import { MarketsClient } from './modules/markets';
import { OrdersClient } from './modules/orders';
import { PositionsClient } from './modules/positions';
import { PriceHistoryClient } from './modules/price-history';
import { RedeemClient } from './modules/redeem';
import { SellClient } from './modules/sell';
import { UsersClient } from './modules/users';
import { WebSocketClient } from './modules/websocket';

export interface PrediktSDKConfig {
  baseUrl: string;
  apiKey: string;
  /** Pre-set a JWT token (e.g. when restoring a session). */
  token?: string;
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
  readonly ws: WebSocketClient;

  private token: string | undefined;
  private readonly http: HttpClient;

  constructor(config: PrediktSDKConfig) {
    if (config.token) this.token = config.token;
    this.http = new HttpClient(config.baseUrl, config.apiKey, () => this.token);

    this.auth = new AuthClient(this.http, (token) => { this.token = token; });
    this.users = new UsersClient(this.http);
    this.markets = new MarketsClient(this.http);
    this.buy = new BuyClient(this.http);
    this.sell = new SellClient(this.http);
    this.redeem = new RedeemClient(this.http);
    this.orders = new OrdersClient(this.http);
    this.positions = new PositionsClient(this.http);
    this.priceHistory = new PriceHistoryClient(this.http);
    this.ws = new WebSocketClient();
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
  PrediktInternalError,
} from './error';
export * from './types';
