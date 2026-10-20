import { HttpClient } from '../http-client.js';
import { ConnectPrivyAppRequest, PrivyApp } from '../types/direct.js';

/** The integrator's Privy app (once per integrator). Backend API key only. */
export class PrivyAppClient {
  constructor(private readonly http: HttpClient) {}

  /** Connects the Privy app; Predikt verifies the App Secret and registers its signer. Repeat-safe. */
  async connect(body: ConnectPrivyAppRequest): Promise<PrivyApp> {
    return (await this.http.request<PrivyApp>('POST', '/direct/privy-app', { body, idempotent: true })).data;
  }

  /** Current connection state; `404 PRIVY_APP_NOT_CONNECTED` before `connect`. */
  async get(): Promise<PrivyApp> {
    return (await this.http.request<PrivyApp>('GET', '/direct/privy-app', { idempotent: true })).data;
  }
}
