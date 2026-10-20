import { createHash, createPrivateKey, KeyObject, sign } from 'node:crypto';
import { ActivateTradingAccountRequest, OwnerApproval, TradingAccount } from '../types/direct.js';
import { canonicalJson } from './canonical-json.js';
import { policyProfileShapes, RULE_KEYS, SIGN_TYPED_DATA } from './policy-profile.js';

const PRIVY_API_URL = 'https://api.privy.io';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** Predikt issues approvals valid for 10 minutes; allow some clock skew on top. */
const MAX_REQUEST_EXPIRY_MS = 15 * 60_000;

export { POLYMARKET_EXCHANGES } from './policy-profile.js';

export type ApprovalCheckCode =
  | 'NOT_AWAITING_APPROVAL'
  | 'APPROVAL_EXPIRED'
  | 'WALLET_MISMATCH'
  | 'DIGEST_MISMATCH'
  | 'PAYLOAD_INVALID'
  | 'OWNER_MISMATCH'
  | 'SIGNERS_CHANGED'
  | 'POLICY_INVALID'
  | 'LIMITS_EXCEEDED'
  | 'PRIVY_REQUEST_FAILED'
  | 'OWNER_KEY_INVALID';

/** The approval was not signed because a check failed. Nothing was sent anywhere. */
export class ApprovalVerificationError extends Error {
  constructor(
    public readonly code: ApprovalCheckCode,
    message: string,
  ) {
    super(`Refusing to sign: ${message}`);
    this.name = 'ApprovalVerificationError';
  }
}

export interface VerifyAndSignApprovalOptions {
  /**
   * The wallet owner's P-256 private key: base64 PKCS#8 DER (optionally `wallet-auth:`-prefixed,
   * as Privy shows it) or PEM. Used only to sign locally; never logged, stored or sent.
   */
  ownerKey: string;
  /** Your Privy app credentials; the checks read the wallet and policy from Privy, not Predikt. */
  privyAppId: string;
  privyAppSecret: string;
  /** What you asked Predikt for. The approval must not grant more. */
  expected: {
    privyWalletId: string;
    maxBuyAmountPerOrder: string;
    expiresAt: string | Date;
    /** Your owner key quorum ID; when set, the approval must be for a wallet owned by it. */
    ownerId?: string;
    /**
     * Predikt's signer (key quorum) ID, e.g. as seen on your first approval; when set, no other
     * signer can be attached or re-pointed.
     */
    delegatedSignerId?: string;
    /** The Deposit Wallet address, if you know it; when set, the approval must be for it. */
    depositWalletAddress?: string;
  };
  /** `fetch` used for the Privy reads (default: the global `fetch`). */
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;
type Signer = { signer_id: string; override_policy_ids: string[] };

function fail(code: ApprovalCheckCode, message: string): never {
  throw new ApprovalVerificationError(code, message);
}

/**
 * Verifies a Predikt owner approval against your expectations and against Privy, then signs it
 * with the wallet owner key. Refuses (throws `ApprovalVerificationError`) unless:
 *
 * 1. `approvalDigest` is the sha256 of the RFC 8785 canonical JSON of `signaturePayload`, and the
 *    approval (and the signed request's `privy-request-expiry`) expires within 15 minutes;
 * 2. the payload is a `PATCH` of exactly your wallet (`expected.privyWalletId`) in your Privy app,
 *    changing only `additional_signers`;
 * 3. per Privy's current wallet: the owner is unchanged, every other signer is kept unchanged, no
 *    signer but Predikt's is added, and Predikt's signer gets exactly `[policyId]`;
 * 4. per Privy's policy: owned by the wallet owner, and every rule is one of Predikt's reviewed
 *    rules (profile v4): Polymarket CLOB login for this wallet's address, orders on the three
 *    Polymarket exchanges, or batches of this Deposit Wallet — typed-data signing only, on Polygon,
 *    expiring (`current_unix_timestamp lt`) no later than `expected.expiresAt`;
 * 5. the stated limits (buy cap, expiry) are not above `expected`.
 *
 * Returns the body for `accounts.activate`. Use it for both registration and re-authorization.
 */
export async function verifyAndSignApproval(
  account: TradingAccount,
  options: VerifyAndSignApprovalOptions,
): Promise<ActivateTradingAccountRequest> {
  const { expected } = options;
  const approval = account.approval;
  if (account.status !== 'awaiting_owner_approval' || !approval) {
    fail('NOT_AWAITING_APPROVAL', `account status is "${account.status}" with no approval to sign`);
  }
  if (account.privyWalletId !== expected.privyWalletId) {
    fail('WALLET_MISMATCH', `approval is for wallet ${account.privyWalletId}, not ${expected.privyWalletId}`);
  }
  const depositWallet = account.depositWalletAddress;
  if (!depositWallet || !ADDRESS.test(depositWallet)) {
    fail('PAYLOAD_INVALID', 'account has no valid depositWalletAddress');
  }
  if (
    expected.depositWalletAddress !== undefined &&
    depositWallet.toLowerCase() !== expected.depositWalletAddress.toLowerCase()
  ) {
    fail('WALLET_MISMATCH', `approval is for Deposit Wallet ${depositWallet}, not ${expected.depositWalletAddress}`);
  }
  const expiresAtMs = new Date(expected.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) throw new TypeError('expected.expiresAt is not a valid date');

  checkApproval(approval, options, expiresAtMs);
  const key = ownerKeyFrom(options.ownerKey);

  const walletPath = `wallets/${encodeURIComponent(expected.privyWalletId)}`;
  const [wallet, policy] = await Promise.all([
    privyGet(walletPath, options),
    privyGet(`policies/${encodeURIComponent(approval.policyId)}`, options),
  ]);
  checkSigners(approval, wallet, expected);
  checkPolicy(approval, policy, wallet, depositWallet, Math.floor(expiresAtMs / 1000));

  // Privy authorization signature: ECDSA P-256 / SHA-256 over the canonical JSON, DER, base64.
  const signature = sign('sha256', Buffer.from(canonicalJson(approval.signaturePayload)), key);
  return { approvalDigest: approval.approvalDigest, signatures: [signature.toString('base64')] };
}

function checkApproval(
  approval: OwnerApproval,
  options: VerifyAndSignApprovalOptions,
  expiresAtMs: number,
): void {
  const { expected } = options;
  const now = Date.now();
  const approvalExpiry = Date.parse(approval.expiresAt);
  if (!(approvalExpiry > now)) {
    fail('APPROVAL_EXPIRED', 'approval expired; request a fresh one (register or reauthorize again)');
  }

  let digest: string;
  try {
    digest = createHash('sha256').update(canonicalJson(approval.signaturePayload)).digest('hex');
  } catch {
    fail('PAYLOAD_INVALID', 'signaturePayload is not plain JSON');
  }
  if (!/^[a-f0-9]{64}$/.test(approval.approvalDigest) || digest !== approval.approvalDigest) {
    fail('DIGEST_MISMATCH', 'approvalDigest does not match signaturePayload');
  }

  const payload = approval.signaturePayload as unknown as Json;
  if (!hasExactKeys(payload, ['body', 'headers', 'method', 'url', 'version'])) {
    fail('PAYLOAD_INVALID', 'signaturePayload has unexpected fields');
  }
  if (payload.version !== 1 || payload.method !== 'PATCH') fail('PAYLOAD_INVALID', 'not a wallet update');
  const walletUrl = `${PRIVY_API_URL}/v1/wallets/${encodeURIComponent(expected.privyWalletId)}`;
  if (payload.url !== walletUrl) fail('WALLET_MISMATCH', 'payload targets a different wallet');

  const headers = payload.headers;
  if (!isRecord(headers) || !hasExactKeys(headers, ['privy-app-id', 'privy-request-expiry'])) {
    fail('PAYLOAD_INVALID', 'payload headers are not the expected Privy headers');
  }
  if (headers['privy-app-id'] !== options.privyAppId) {
    fail('PAYLOAD_INVALID', 'payload targets a different Privy app');
  }
  // The signed request must not stay valid longer than the approval: a long expiry would let the
  // signed signer update be replayed later (e.g. after you removed Predikt's signer).
  const requestExpiry = headers['privy-request-expiry'];
  const requestExpiryMs = typeof requestExpiry === 'string' && /^\d+$/.test(requestExpiry) ? Number(requestExpiry) : NaN;
  if (
    requestExpiryMs !== approvalExpiry ||
    requestExpiryMs - now > MAX_REQUEST_EXPIRY_MS ||
    requestExpiryMs > expiresAtMs
  ) {
    fail('PAYLOAD_INVALID', 'privy-request-expiry is not the approval expiry within the next 15 minutes');
  }

  const body = payload.body;
  if (!isRecord(body) || !hasExactKeys(body, ['additional_signers'])) {
    fail('PAYLOAD_INVALID', 'payload changes more than additional signers (e.g. owner or policies)');
  }
  const signers = body.additional_signers;
  if (!Array.isArray(signers) || !signers.every(isSigner)) {
    fail('PAYLOAD_INVALID', 'additional_signers is malformed');
  }
  if (new Set(signers.map((signer) => signer.signer_id)).size !== signers.length) {
    fail('SIGNERS_CHANGED', 'additional_signers lists a signer twice');
  }
  if (!isId(approval.ownerId) || !isId(approval.delegatedSignerId) || !isId(approval.policyId)) {
    fail('PAYLOAD_INVALID', 'approval is missing its owner, signer or policy ID');
  }
  if (approval.delegatedSignerId === approval.ownerId) {
    fail('OWNER_MISMATCH', "Predikt's signer is the wallet owner");
  }
  if (expected.ownerId !== undefined && approval.ownerId !== expected.ownerId) {
    fail('OWNER_MISMATCH', `approval owner ${approval.ownerId} is not ${expected.ownerId}`);
  }
  if (expected.delegatedSignerId !== undefined && approval.delegatedSignerId !== expected.delegatedSignerId) {
    fail('SIGNERS_CHANGED', `approval attaches signer ${approval.delegatedSignerId}, not ${expected.delegatedSignerId}`);
  }

  const cap = approval.limits.maxBuyAmountPerOrder;
  if (cap === null || !/^\d+$/.test(cap) || BigInt(cap) > BigInt(expected.maxBuyAmountPerOrder)) {
    fail('LIMITS_EXCEEDED', `stated buy cap ${cap} is above the requested ${expected.maxBuyAmountPerOrder}`);
  }
  if (!(Date.parse(approval.limits.expiresAt) <= expiresAtMs)) {
    fail('LIMITS_EXCEEDED', `stated expiry ${approval.limits.expiresAt} is later than requested`);
  }
}

/** Existing signers must be kept exactly; only Predikt's signer may be added or re-pointed. */
function checkSigners(approval: OwnerApproval, wallet: Json, expected: VerifyAndSignApprovalOptions['expected']): void {
  if (wallet.id !== undefined && wallet.id !== expected.privyWalletId) {
    fail('WALLET_MISMATCH', 'Privy returned a different wallet');
  }
  if (!isId(wallet.owner_id) || wallet.owner_id !== approval.ownerId) {
    fail('OWNER_MISMATCH', 'approval owner differs from the wallet owner');
  }

  const current = wallet.additional_signers ?? [];
  if (!Array.isArray(current)) fail('PRIVY_REQUEST_FAILED', 'Privy wallet has malformed additional_signers');
  const proposed = approval.signaturePayload.body.additional_signers;
  for (const signer of current as Json[]) {
    if (signer.signer_id === approval.delegatedSignerId) continue;
    const kept = proposed.find((item) => item.signer_id === signer.signer_id);
    const policies = Array.isArray(signer.override_policy_ids) ? signer.override_policy_ids : [];
    if (!kept || !sameList(kept.override_policy_ids, policies)) {
      fail('SIGNERS_CHANGED', `existing signer ${String(signer.signer_id)} would be removed or changed`);
    }
  }
  const known = new Set((current as Json[]).map((signer) => signer.signer_id));
  if (proposed.some((item) => item.signer_id !== approval.delegatedSignerId && !known.has(item.signer_id))) {
    fail('SIGNERS_CHANGED', 'adds a signer other than Predikt');
  }
  const ours = proposed.find((item) => item.signer_id === approval.delegatedSignerId);
  if (!ours || !sameList(ours.override_policy_ids, [approval.policyId])) {
    fail('SIGNERS_CHANGED', "Predikt's signer is not limited to exactly the approved policy");
  }
}

/**
 * Every rule must be one of Predikt's reviewed rules (the backend's TradingPolicyCheckerService
 * recognizes the same shapes): anything else could widen what Predikt can sign.
 */
function checkPolicy(
  approval: OwnerApproval,
  policy: Json,
  wallet: Json,
  depositWallet: string,
  expiresAtUnix: number,
): void {
  if (policy.id !== undefined && policy.id !== approval.policyId) {
    fail('POLICY_INVALID', 'Privy returned a different policy');
  }
  if (!isId(policy.owner_id) || policy.owner_id !== approval.ownerId) {
    fail('POLICY_INVALID', 'policy is not owned by the wallet owner');
  }
  const signerAddress = wallet.address;
  if (typeof signerAddress !== 'string' || !ADDRESS.test(signerAddress)) {
    fail('PRIVY_REQUEST_FAILED', 'Privy wallet has no address');
  }
  const rules = policy.rules;
  if (!Array.isArray(rules) || rules.length === 0 || rules.length > 100 || !rules.every(isRecord)) {
    fail('POLICY_INVALID', 'policy has no readable rules');
  }

  rules.forEach((rule, index) => {
    const where = `rule ${index} (${String(rule.name ?? 'unnamed')})`;
    if (!Object.keys(rule).every((key) => RULE_KEYS.includes(key))) fail('POLICY_INVALID', `${where} has unknown fields`);
    const conditions = rule.conditions;
    if (!Array.isArray(conditions) || !conditions.every(isRecord)) {
      fail('POLICY_INVALID', `${where} has malformed conditions`);
    }
    // An unconditional DENY of another method cannot widen authority.
    if (rule.action === 'DENY') {
      if (conditions.length === 0 && typeof rule.method === 'string' && rule.method !== SIGN_TYPED_DATA && rule.method !== '*') return;
      fail('POLICY_INVALID', `${where} is an unsupported DENY rule`);
    }
    if (rule.action !== 'ALLOW') fail('POLICY_INVALID', `${where} has an unknown action`);
    // Only typed-data signing: no transactions, raw messages or key export.
    if (rule.method !== SIGN_TYPED_DATA) fail('POLICY_INVALID', `${where} allows ${String(rule.method)}`);

    const clocks = conditions.filter((c) => c.field_source === 'system');
    const until = clocks[0]?.value;
    if (
      clocks.length !== 1 ||
      !hasExactKeys(clocks[0], ['field', 'field_source', 'operator', 'value']) ||
      clocks[0].field !== 'current_unix_timestamp' ||
      clocks[0].operator !== 'lt' ||
      typeof until !== 'string' ||
      !/^\d+$/.test(until) ||
      Number(until) > expiresAtUnix
    ) {
      fail('POLICY_INVALID', `${where} is missing the expiry or expires later than requested`);
    }
    const content = conditions.filter((c) => c.field_source !== 'system');
    const shapes = policyProfileShapes({ depositWallet, signerAddress, until });
    if (!shapes.some((shape) => sameSet(content, shape))) {
      fail('POLICY_INVALID', `${where} is not one of Predikt's reviewed rules (unexpected contract, chain or scope)`);
    }
  });
}

async function privyGet(path: string, options: VerifyAndSignApprovalOptions): Promise<Json> {
  const credentials = Buffer.from(`${options.privyAppId}:${options.privyAppSecret}`).toString('base64');
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${PRIVY_API_URL}/v1/${path}`, {
      headers: { 'privy-app-id': options.privyAppId, Authorization: `Basic ${credentials}` },
    });
  } catch {
    fail('PRIVY_REQUEST_FAILED', `Privy GET /v1/${path} failed`);
  }
  if (!response.ok) fail('PRIVY_REQUEST_FAILED', `Privy GET /v1/${path} returned ${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) fail('PRIVY_REQUEST_FAILED', `Privy GET /v1/${path} returned no JSON object`);
  return body;
}

function ownerKeyFrom(value: string): KeyObject {
  try {
    const text = value.trim();
    const key = text.startsWith('-----BEGIN')
      ? createPrivateKey(text)
      : createPrivateKey({
          key: Buffer.from(text.replace(/^wallet-auth:/, ''), 'base64'),
          format: 'der',
          type: 'pkcs8',
        });
    if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return key;
  } catch {
    // Fall through: never surface parser details about key material.
  }
  fail('OWNER_KEY_INVALID', 'ownerKey must be a P-256 private key (base64 PKCS#8 DER or PEM)');
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasExactKeys(value: Json, keys: string[]): boolean {
  return sameList(Object.keys(value).sort(), [...keys].sort());
}

function isSigner(value: unknown): value is Signer {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['override_policy_ids', 'signer_id']) &&
    typeof value.signer_id === 'string' &&
    value.signer_id.length > 0 &&
    Array.isArray(value.override_policy_ids) &&
    value.override_policy_ids.every((id) => typeof id === 'string')
  );
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** Deep equality; addresses compare case-insensitively (Privy stores them checksummed). */
function same(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string' && ADDRESS.test(a) && ADDRESS.test(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i], depth + 1));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key], depth + 1))
  );
}

/** `actual` and `expected` hold the same conditions, in any order. */
function sameSet(actual: unknown[], expected: unknown[]): boolean {
  const remaining = [...actual];
  for (const item of expected) {
    const index = remaining.findIndex((value) => same(value, item));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}
