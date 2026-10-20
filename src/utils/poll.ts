import { isTransientError } from './retry.js';

/** Options for the `waitForOrder` helpers. */
export interface WaitForOrderOptions {
  /**
   * Stop polling after this long and return the latest snapshot. A timeout does NOT mean the
   * order failed: check its status, keep the user's funds reserved while it is not final, and
   * poll again later.
   */
  timeoutMs?: number;
  /** First delay between polls; grows 1.5× per poll up to `maxIntervalMs`. */
  intervalMs?: number;
  maxIntervalMs?: number;
  /** Abort the wait (rejects with the signal's reason). */
  signal?: AbortSignal;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Loads `load()` until `done` holds or the timeout passes, then returns the latest value.
 * `initial`, when given, is used as the first value instead of a load. Once a value is known,
 * transient load failures (network, 429, 5xx) are skipped rather than thrown, so a failed poll is
 * never mistaken for a failed order; other errors (e.g. 404) are thrown.
 */
export async function pollUntil<T>(
  load: () => Promise<T>,
  done: (value: T) => boolean,
  initial: T | undefined,
  options: WaitForOrderOptions,
  defaults: Required<Omit<WaitForOrderOptions, 'signal'>>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
  const maxIntervalMs = options.maxIntervalMs ?? defaults.maxIntervalMs;
  let interval = options.intervalMs ?? defaults.intervalMs;
  const deadline = Date.now() + timeoutMs;

  let latest = initial ?? (await load());
  while (!done(latest)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return latest;
    await sleep(Math.min(interval, remaining), options.signal);
    try {
      latest = await load();
    } catch (error) {
      if (!isTransientError(error)) throw error;
    }
    interval = Math.min(interval * 1.5, maxIntervalMs);
  }
  return latest;
}
