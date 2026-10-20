import { buildApiError, PrediktErrorDetails } from './error.js';
import { markNetworkError, RetryPolicy, RetryState } from './utils/retry.js';
import { sleep } from './utils/poll.js';

/** A single query parameter value — scalars, arrays (repeated keys), or absent. */
export type QueryParamValue = string | number | boolean | string[];
export type QueryParams = Record<string, QueryParamValue | undefined>;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  query?: QueryParams;
  body?: object;
  /**
   * The request is safe to repeat as-is (idempotency key, or a repeat-safe endpoint): apply the
   * client's retry policy. Leave unset for requests that could act twice.
   */
  idempotent?: boolean;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
}

export interface HttpClientOptions {
  /** Abort a request after this many milliseconds. */
  timeoutMs?: number;
  /** Policy for `idempotent` requests; undefined disables retries. */
  retry?: RetryPolicy;
}

export class HttpClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly getToken: () => string | undefined,
    private readonly options: HttpClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };
    const token = this.getToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  private url(path: string, params?: QueryParams): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
        else url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async handle<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let message = res.statusText;
      let code: string | undefined;
      let details: PrediktErrorDetails | undefined;
      try {
        const body = (await res.json()) as {
          message?: string | string[];
          code?: string;
          details?: unknown;
        };
        if (body.message) {
          message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        }
        if (body.code) code = body.code;
        if (body.details && typeof body.details === 'object' && !Array.isArray(body.details)) {
          details = body.details as PrediktErrorDetails;
        }
      } catch {}
      const retryAfterRaw = res.headers.get('Retry-After');
      const retryAfter = retryAfterRaw !== null ? Number(retryAfterRaw) : NaN;
      throw buildApiError(
        res.status,
        message,
        code,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
        details,
      );
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async send<T>(method: HttpMethod, path: string, options: RequestOptions): Promise<HttpResponse<T>> {
    const url = this.url(path, options.query);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(),
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: this.options.timeoutMs ? AbortSignal.timeout(this.options.timeoutMs) : undefined,
      });
    } catch (error) {
      markNetworkError(error);
      throw error;
    }
    try {
      return { status: res.status, data: await this.handle<T>(res) };
    } catch (error) {
      // The connection dropped or timed out while the body was read.
      if (error instanceof Error && ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)) {
        markNetworkError(error);
      }
      throw error;
    }
  }

  /** Sends one request; repeats it per the retry policy when `options.idempotent` is set. */
  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const policy = options.idempotent ? this.options.retry : undefined;
    const retries = policy ? new RetryState(policy) : undefined;
    for (;;) {
      try {
        return await this.send<T>(method, path, options);
      } catch (error) {
        const delay = retries?.next(error) ?? null;
        if (delay === null) throw error;
        await sleep(delay);
      }
    }
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return (await this.request<T>('GET', path, { query: params })).data;
  }

  async post<T>(path: string, body?: object): Promise<T> {
    return (await this.request<T>('POST', path, { body })).data;
  }

  async delete<T>(path: string): Promise<T> {
    return (await this.request<T>('DELETE', path)).data;
  }

  async patch<T>(path: string, body?: object): Promise<T> {
    return (await this.request<T>('PATCH', path, { body })).data;
  }
}
