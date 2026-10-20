import { AccountRef, WalletRef } from '../types/direct.js';

export function accountIdOf(ref: AccountRef): string {
  const id = typeof ref === 'string' ? ref : ref.accountId;
  if (!id) {
    throw new TypeError('Trading account has no accountId yet (still provisioning); register it again.');
  }
  return id;
}

export function walletOf(ref: WalletRef): string {
  const wallet = typeof ref === 'string' ? ref : ref.depositWalletAddress;
  if (!wallet) {
    throw new TypeError('Trading account has no depositWalletAddress yet (still provisioning).');
  }
  return wallet;
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
