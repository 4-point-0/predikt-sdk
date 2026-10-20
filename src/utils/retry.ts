import { PrediktApiError } from '../error.js';

/**
 * Automatic retries for direct-trading and combo calls. Every one of those calls is idempotent
 * (idempotency key, clientOrderId, or a repeat-safe endpoint), so the SDK re-sends the SAME
 * request; it never changes the key.
 */
export interface RetryOptions {
  /**
   * Retries after a network error, timeout, or 5xx with `details.retryable: true` that names no
   * recorded order (default 2).
   */
  maxRetries?: number;
  /** First backoff for those retries; doubles each time (default 500 ms). */
  baseDelayMs?: number;
  /** Upper bound for that backoff (default 8 s). */
  maxDelayMs?: number;
  /** Wait before repeating a request that got `409 TRADING_APPROVALS_PENDING` (default 15 s). */
  approvalsPendingDelayMs?: number;
  /** How many times to repeat on `TRADING_APPROVALS_PENDING` (default 3). */
  approvalsPendingMaxRetries?: number;
}

export type RetryPolicy = Required<RetryOptions>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  approvalsPendingDelayMs: 15_000,
  approvalsPendingMaxRetries: 3,
};

export function resolveRetryPolicy(options: RetryOptions | false | undefined): RetryPolicy | undefined {
  if (options === false) return undefined;
  return { ...DEFAULT_RETRY_POLICY, ...options };
}

/** Errors thrown by `fetch` itself (no HTTP response): connection failures and timeouts. */
const networkErrors = new WeakSet<object>();

export function markNetworkError(error: unknown): void {
  if (typeof error === 'object' && error !== null) networkErrors.add(error);
}

export function isNetworkError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && networkErrors.has(error);
}

/** Worth polling again: no response, a rate limit, or a server-side failure. */
export function isTransientError(error: unknown): boolean {
  return isNetworkError(error) || (error instanceof PrediktApiError && (error.status === 429 || error.status >= 500));
}

/** Tracks the two retry budgets of one logical request. */
export class RetryState {
  private transient = 0;
  private approvalsPending = 0;

  constructor(private readonly policy: RetryPolicy) {}

  /** Milliseconds to wait before the next attempt, or null to give up and rethrow `error`. */
  next(error: unknown): number | null {
    if (error instanceof PrediktApiError && error.code === 'TRADING_APPROVALS_PENDING') {
      if (this.approvalsPending >= this.policy.approvalsPendingMaxRetries) return null;
      this.approvalsPending++;
      return this.policy.approvalsPendingDelayMs;
    }
    // A 5xx that names a recorded order is final for that key (Predikt asks for a new key), so
    // repeating it would only return the recorded order.
    const transient =
      isNetworkError(error) ||
      (error instanceof PrediktApiError &&
        error.status >= 500 &&
        error.retryable === true &&
        error.orderId === undefined);
    if (!transient || this.transient >= this.policy.maxRetries) return null;
    const delay = Math.min(this.policy.baseDelayMs * 2 ** this.transient, this.policy.maxDelayMs);
    this.transient++;
    return delay;
  }
}
