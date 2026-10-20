import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/server.js';
import type { ComboOrder, DirectOrder, OwnerApproval, TradingAccount } from '../src/index.js';
import { ACCOUNT_ID, WALLET } from './helpers.js';

export const PRIVY_APP_ID = 'cmprivyapp000000000000001';
export const PRIVY_WALLET_ID = 'sunjel6yyoyj6ymjll2tk5xm';
export const OWNER_ID = 'owner-quorum-1';
export const PREDIKT_SIGNER_ID = 'predikt-signer-1';
export const POLICY_ID = 'gdcyf95lt8ohcclveqtiicf2';
export const SIGNER_ADDRESS = '0x1111111111111111111111111111111111111111';
export const EXPIRES_AT = '2027-12-15T12:00:00.000Z';
export const MAX_BUY = '10000000';

const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Mirrors the backend's AuthorizationSetupMapper.prepare/toResponse. */
export function approvalAccount(
  options: {
    existingSigners?: { signer_id: string; override_policy_ids: string[] }[];
    mutate?: (approval: OwnerApproval) => void;
    keepDigest?: boolean;
  } = {},
): TradingAccount {
  const signers = (options.existingSigners ?? []).filter((s) => s.signer_id !== PREDIKT_SIGNER_ID);
  const requestExpiry = Date.now() + 10 * 60_000;
  const approval: OwnerApproval = {
    authorizationId: '2b1f2a8e-7c1e-4f53-9a7b-3f0b4b0d8f11',
    ownerId: OWNER_ID,
    delegatedSignerId: PREDIKT_SIGNER_ID,
    policyId: POLICY_ID,
    limits: {
      allowedActions: ['buy', 'sell', 'redeem', 'cancel'],
      maxBuyAmountPerOrder: MAX_BUY,
      expiresAt: EXPIRES_AT,
    },
    approvalDigest: '',
    signaturePayload: {
      version: 1,
      method: 'PATCH',
      url: `https://api.privy.io/v1/wallets/${PRIVY_WALLET_ID}`,
      headers: {
        'privy-app-id': PRIVY_APP_ID,
        'privy-request-expiry': String(requestExpiry),
      },
      body: {
        additional_signers: [
          ...signers.map((s) => ({ signer_id: s.signer_id, override_policy_ids: [...s.override_policy_ids] })),
          { signer_id: PREDIKT_SIGNER_ID, override_policy_ids: [POLICY_ID] },
        ],
      },
    },
    expiresAt: new Date(requestExpiry).toISOString(),
    batchCallScope: 'unrestricted',
  };
  approval.approvalDigest = sha256(approval.signaturePayload);
  options.mutate?.(approval);
  if (!options.keepDigest) approval.approvalDigest = sha256(approval.signaturePayload);
  return {
    accountId: ACCOUNT_ID,
    status: 'awaiting_owner_approval',
    privyWalletId: PRIVY_WALLET_ID,
    depositWalletAddress: WALLET,
    maxBuyAmountPerOrder: MAX_BUY,
    expiresAt: EXPIRES_AT,
    activeGrant: null,
    approval,
  };
}

/** Privy GET /v1/wallets/:id. */
export function privyWallet(additionalSigners: { signer_id: string; override_policy_ids: string[] }[] = []) {
  return {
    id: PRIVY_WALLET_ID,
    address: SIGNER_ADDRESS,
    chain_type: 'ethereum',
    owner_id: OWNER_ID,
    additional_signers: additionalSigners,
    policy_ids: [],
  };
}

const fields = (entries: [string, string][]) => entries.map(([name, type]) => ({ name, type }));
const DOMAIN = fields([
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
]);
const AUTH_SCHEMAS = [false, true].map((withDomain) => ({
  primary_type: 'ClobAuth',
  types: {
    ...(withDomain ? { EIP712Domain: DOMAIN } : {}),
    ClobAuth: fields([
      ['address', 'address'],
      ['timestamp', 'string'],
      ['nonce', 'uint256'],
      ['message', 'string'],
    ]),
  },
}));
const BATCH_SCHEMAS = [false, true].map((withDomain) => ({
  primary_type: 'Batch',
  types: {
    ...(withDomain ? { EIP712Domain: [...DOMAIN, { name: 'verifyingContract', type: 'address' }] } : {}),
    Batch: fields([
      ['wallet', 'address'],
      ['nonce', 'uint256'],
      ['deadline', 'uint256'],
      ['calls', 'Call[]'],
    ]),
    Call: fields([
      ['target', 'address'],
      ['value', 'uint256'],
      ['data', 'bytes'],
    ]),
  },
}));
/** Checksummed, as Privy stores them. */
const EXCHANGES = [
  '0xE111180000d2663C0091e4f400237545B87B996B',
  '0xe2222d279d744050d28e00520010520000310F59',
  '0xe3333700cA9d93003F00f0F71f8515005F6c00Aa',
];
const CHECKSUM_WALLET = '0xcD466971e81fD723dbeef85dD37Cb3993ff89B38';

type Rule = { id?: string; name: string; method: string; action: string; conditions: Record<string, unknown>[] };

/** Privy GET /v1/policies/:id for a policy built like the backend's TradingPolicyInputMapper (profile v4). */
export function privyPolicy(mutate?: (rules: Rule[]) => void) {
  const until = String(Math.floor(new Date(EXPIRES_AT).getTime() / 1000));
  const expiry = () => ({ field_source: 'system', field: 'current_unix_timestamp', operator: 'lt', value: until });
  const domain = (field: string, value: string) => ({ field_source: 'ethereum_typed_data_domain', field, operator: 'eq', value });
  const message = (typed_data: unknown, field: string, value: string, operator = 'eq') => ({
    field_source: 'ethereum_typed_data_message',
    typed_data,
    field,
    operator,
    value,
  });
  const allow = (name: string, conditions: Record<string, unknown>[]): Rule => ({
    name,
    method: 'eth_signTypedData_v4',
    action: 'ALLOW',
    conditions: [...conditions, expiry()],
  });
  const rules: Rule[] = [
    ...AUTH_SCHEMAS.map((schema) =>
      allow('CLOB login', [
        domain('chainId', '137'),
        message(schema, 'address', SIGNER_ADDRESS),
        message(schema, 'message', 'This message attests that I control the given wallet'),
      ]),
    ),
    ...EXCHANGES.map((exchange) => allow('Polymarket order', [domain('chainId', '137'), domain('verifyingContract', exchange)])),
    ...BATCH_SCHEMAS.map((schema) =>
      allow('Wallet batch - unrestricted inner calls', [
        domain('chainId', '137'),
        domain('verifyingContract', CHECKSUM_WALLET),
        message(schema, 'wallet', CHECKSUM_WALLET),
        message(schema, 'deadline', until, 'lte'),
      ]),
    ),
  ].map((rule, index) => ({ id: `rule-${index}`, ...rule }));
  mutate?.(rules);
  return { id: POLICY_ID, name: 'Predikt policy', version: '1.0', chain_type: 'ethereum', owner_id: OWNER_ID, rules };
}

export function directOrder(overrides: Partial<DirectOrder> = {}): DirectOrder {
  return {
    orderId: '0b5c7d36-6c39-4b8e-9d55-1f5f3a1c2e01',
    accountId: ACCOUNT_ID,
    side: 'buy',
    source: 'integrator',
    status: 'filled',
    tokenId: '5511',
    conditionId: null,
    redeemedPositions: null,
    amount: '2000000',
    principal: '1940000',
    slippagePercent: '5',
    bestPriceAtOrder: '0.17',
    limitPrice: '0.17',
    clobOrderId: '0xabc',
    spentAmount: '1940000',
    receivedAmount: null,
    filledShares: '11411765',
    transactionHashes: ['0xdead'],
    reasonCode: null,
    fees: null,
    ...overrides,
  };
}

export function comboOrder(overrides: Partial<ComboOrder> = {}): ComboOrder {
  return {
    id: 'd996c1c8-6a2e-4c84-9abf-055ce870986c',
    clientOrderId: 'casino-combo-0001',
    wallet: WALLET,
    direction: 'BUY',
    source: 'API',
    status: 'FILLED',
    comboConditionId: '0x03d3cd957beec0a5317055175d094724d40000000000000000000000000000',
    comboPositionId: '1731162164502812695115467381097927256135825727012517871095417272864694337536',
    legs: [
      { marketId: '682708', outcome: 0, outcomeLabel: 'Yes', title: 'A', positionId: '1' },
      { marketId: '1090496', outcome: 1, outcomeLabel: 'No', title: 'B', positionId: '2' },
    ],
    requestedAmount: '2000000',
    requestedShares: null,
    limitPrice: '0.41',
    quotedPrice: '0.3839',
    effectivePrice: '0.395725',
    shares: '5054026',
    amount: '2000000',
    rfqId: 'rfq-1',
    txHash: '0xc36b',
    error: null,
    createdAt: '2026-10-16T13:20:27.096Z',
    filledAt: '2026-10-16T13:20:35.291Z',
    ...overrides,
  };
}
