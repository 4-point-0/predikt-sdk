import { HttpClient } from '../http-client';
import { ChallengeRequest, ChallengeResponse, VerifyRequest, VerifyResponse } from '../types/auth';
import { WalletChain } from '../types/common';

export class AuthClient {
  constructor(
    private readonly http: HttpClient,
    private readonly setToken: (token: string) => void,
  ) {}

  getChallenge(walletAddress: string, chain: WalletChain): Promise<ChallengeResponse> {
    return this.http.post<ChallengeResponse>('/auth/challenge', {
      walletAddress,
      chain,
    } satisfies ChallengeRequest);
  }

  async verify(body: VerifyRequest): Promise<VerifyResponse> {
    const res = await this.http.post<VerifyResponse>('/auth/verify', body);
    this.setToken(res.access_token);
    return res;
  }
}
