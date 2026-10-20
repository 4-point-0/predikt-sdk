// Predikt's reviewed Privy policy language, profile `polymarket-privy-1271-broad-batch-v4`.
// Mirrors the backend's trading-policy-profile.ts / TradingPolicyInputMapper: a new profile on
// the backend needs a matching SDK release, by design.

export const SIGN_TYPED_DATA = 'eth_signTypedData_v4';
export const RULE_KEYS = ['id', 'name', 'method', 'action', 'conditions'];
const POLYGON_CHAIN_ID = '137';
const CLOB_AUTH_MESSAGE = 'This message attests that I control the given wallet';

/** Polymarket CTF Exchange, NegRisk CTF Exchange and Exchange v3 (Combos). */
export const POLYMARKET_EXCHANGES: readonly string[] = [
  '0xe111180000d2663c0091e4f400237545b87b996b',
  '0xe2222d279d744050d28e00520010520000310f59',
  '0xe3333700ca9d93003f00f0f71f8515005f6c00aa',
];

const fields = (entries: [string, string][]) => entries.map(([name, type]) => ({ name, type }));
const DOMAIN = fields([
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
]);
// Type field order matters; both shapes (with and without EIP712Domain) are emitted by signers.
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

const domain = (field: string, value: string) => ({ field_source: 'ethereum_typed_data_domain', field, operator: 'eq', value });
const message = (typed_data: unknown, field: string, value: string, operator = 'eq') => ({
  field_source: 'ethereum_typed_data_message',
  typed_data,
  field,
  operator,
  value,
});

/**
 * The non-expiry conditions each allowed rule may have, exactly: CLOB login for the wallet's own
 * address, an order on one Polymarket exchange, or a batch of this Deposit Wallet whose deadline
 * is not after the rule's expiry (`until`).
 */
export function policyProfileShapes(binding: {
  depositWallet: string;
  signerAddress: string;
  until: string;
}): Record<string, unknown>[][] {
  const chain = domain('chainId', POLYGON_CHAIN_ID);
  return [
    ...AUTH_SCHEMAS.map((schema) => [
      chain,
      message(schema, 'address', binding.signerAddress),
      message(schema, 'message', CLOB_AUTH_MESSAGE),
    ]),
    ...POLYMARKET_EXCHANGES.map((exchange) => [chain, domain('verifyingContract', exchange)]),
    ...BATCH_SCHEMAS.map((schema) => [
      chain,
      domain('verifyingContract', binding.depositWallet),
      message(schema, 'wallet', binding.depositWallet),
      message(schema, 'deadline', binding.until, 'lte'),
    ]),
  ];
}
