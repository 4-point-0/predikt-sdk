import { WalletChain } from './common.js';

export interface ChallengeRequest {
  walletAddress: string;
  chain: WalletChain;
}

export interface ChallengeResponse {
  nonce: string;
  message: string;
  isNewUser: boolean;
}

export interface VerifyRequest {
  walletAddress: string;
  chain: WalletChain;
  nonce: string;
  signature: string;
  referralCode?: string;
}

export interface VerifyResponse {
  access_token: string;
}

export interface ReferralInfo {
  referralCode: string;
  referredByCode: string | null;
  referralCount: number;
}
