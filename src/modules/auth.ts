import { HttpClient } from '../http-client';
import { ChallengeRequest, ChallengeResponse, VerifyRequest, VerifyResponse } from '../types/auth';
import { WalletChain } from '../types/common';

export class AuthClient {
  constructor(private readonly http: HttpClient) {}

  getChallenge(walletAddress: string, chain: WalletChain): Promise<ChallengeResponse> {
    return this.http.post<ChallengeResponse>('/auth/challenge', {
      walletAddress,
      chain,
    } satisfies ChallengeRequest);
  }

  verify(body: VerifyRequest): Promise<VerifyResponse> {
    return this.http.post<VerifyResponse>('/auth/verify', body);
  }
}
