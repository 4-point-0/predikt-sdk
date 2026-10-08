import { HttpClient } from '../http-client.js';
import { ReferralInfo } from '../types/auth.js';

export class UsersClient {
  constructor(private readonly http: HttpClient) {}

  getReferralInfo(): Promise<ReferralInfo> {
    return this.http.get<ReferralInfo>('/users/me/referral');
  }
}
