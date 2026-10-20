import { vi } from 'vitest';
import { PrediktSDK, PrediktSDKConfig } from '../src/index.js';

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export type Route = (call: RecordedCall) => Response | Promise<Response>;

/** Replaces global fetch with `route` and records every call. */
export function mockFetch(route: Route) {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return route(call);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function apiError(statusCode: number, code: string, details?: Record<string, unknown>): Response {
  return json(statusCode, { statusCode, code, message: `${code} message`, ...(details ? { details } : {}) });
}

export const BASE_URL = 'https://api.predikt.test';
export const API_KEY = 'sk_predikt_test';

export function sdk(config: Partial<PrediktSDKConfig> = {}): PrediktSDK {
  return new PrediktSDK({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    retry: { baseDelayMs: 1, maxDelayMs: 2, approvalsPendingDelayMs: 1 },
    ...config,
  });
}

export const ACCOUNT_ID = 'afde0f86-88f9-4e83-8ed3-42cdd831e9bb';
export const WALLET = '0xcd466971e81fd723dbeef85dd37cb3993ff89b38';
