import { HttpClient } from '../http-client';
import { ReferralInfo } from '../types/auth';

export class UsersClient {
  constructor(private readonly http: HttpClient) {}

  getReferralInfo(): Promise<ReferralInfo> {
    return this.http.get<ReferralInfo>('/users/me/referral');
  }
}
