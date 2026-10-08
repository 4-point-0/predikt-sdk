import { buildApiError } from './error.js';

/** A single query parameter value — scalars, arrays (repeated keys), or absent. */
export type QueryParamValue = string | number | boolean | string[];
export type QueryParams = Record<string, QueryParamValue | undefined>;

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly getToken: () => string | undefined,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };
    const token = this.getToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  private async handle<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let message = res.statusText;
      let code: string | undefined;
      try {
        const body = (await res.json()) as { message?: string | string[]; code?: string };
        if (body.message) {
          message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        }
        if (body.code) code = body.code;
      } catch {}
      const retryAfterRaw = res.headers.get('Retry-After');
      const retryAfter = retryAfterRaw !== null ? Number(retryAfterRaw) : NaN;
      throw buildApiError(
        res.status,
        message,
        code,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
        else url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), { headers: this.headers() });
    return this.handle<T>(res);
  }

  async post<T>(path: string, body?: object): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handle<T>(res);
  }

  async delete<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return this.handle<T>(res);
  }

  async patch<T>(path: string, body?: object): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handle<T>(res);
  }
}
