import { HttpClient } from '../http-client.js';
import {
  AccountRef,
  ActivateTradingAccountRequest,
  ReauthorizeTradingAccountRequest,
  RedeemableMarkets,
  RegisterTradingAccountOptions,
  RegisterTradingAccountRequest,
  TradingAccount,
  TradingAccountPortfolio,
} from '../types/direct.js';
import { sleep } from '../utils/poll.js';
import { accountIdOf, pathSegment } from '../utils/refs.js';

const PROVISIONING_POLL_MS = 3_000;
const PROVISIONING_TIMEOUT_MS = 120_000;

/** Trading accounts: one per Privy wallet. Backend API key only. */
export class AccountsClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Registers a Privy wallet (or returns its current state; repeat-safe). While the Deposit
   * Wallet is being deployed (`202 provisioning`) the same request is repeated until it is ready,
   * unless `waitForProvisioning: false`.
   *
   * Next step by status: `awaiting_owner_approval` → `verifyAndSignApproval` then `activate`;
   * `active` → done; `unavailable` → `reauthorize`; `provisioning` (timed out) → call again later.
   */
  async register(
    body: RegisterTradingAccountRequest,
    options: RegisterTradingAccountOptions = {},
  ): Promise<TradingAccount> {
    const wait = options.waitForProvisioning ?? true;
    const deadline = Date.now() + (options.timeoutMs ?? PROVISIONING_TIMEOUT_MS);
    for (;;) {
      const { data } = await this.http.request<TradingAccount>('POST', '/direct/trading-accounts', {
        body,
        idempotent: true,
      });
      const remaining = deadline - Date.now();
      if (data.status !== 'provisioning' || !wait || remaining <= 0) return data;
      await sleep(Math.min(options.pollIntervalMs ?? PROVISIONING_POLL_MS, remaining), options.signal);
    }
  }

  /** Current status and limits. Never issues an approval. */
  async get(account: AccountRef): Promise<TradingAccount> {
    return this.call('GET', `/${pathSegment(accountIdOf(account))}`);
  }

  /** Submits the owner-signed approval (from `verifyAndSignApproval`). Repeating after success returns `active`. */
  async activate(account: AccountRef, body: ActivateTradingAccountRequest): Promise<TradingAccount> {
    return this.call('POST', `/${pathSegment(accountIdOf(account))}/activate`, {
      approvalDigest: body.approvalDigest,
      signatures: body.signatures,
    });
  }

  /**
   * Requests new limits (or a policy upgrade, e.g. to enable combos on pre-v4 grants). Returns
   * `awaiting_owner_approval` with a new approval to verify, sign and activate; trading continues
   * under the old grant (`activeGrant`) until activation.
   */
  async reauthorize(account: AccountRef, body: ReauthorizeTradingAccountRequest): Promise<TradingAccount> {
    return this.call('POST', `/${pathSegment(accountIdOf(account))}/reauthorize`, {
      maxBuyAmountPerOrder: body.maxBuyAmountPerOrder,
      expiresAt: body.expiresAt,
    });
  }

  /** pUSD/USDC.e balances and open regular positions of the Deposit Wallet. */
  async portfolio(account: AccountRef): Promise<TradingAccountPortfolio> {
    return this.call('GET', `/${pathSegment(accountIdOf(account))}/portfolio`);
  }

  /** Resolved markets the wallet can redeem now, with exact payouts. */
  async redeemable(account: AccountRef): Promise<RedeemableMarkets> {
    return this.call('GET', `/${pathSegment(accountIdOf(account))}/redeemable`);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const { data } = await this.http.request<T>(method, `/direct/trading-accounts${path}`, {
      body,
      idempotent: true,
    });
    return data;
  }
}
