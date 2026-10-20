import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApprovalVerificationError,
  canonicalJson,
  verifyAndSignApproval,
  VerifyAndSignApprovalOptions,
} from '../src/server.js';
import type { TradingAccount } from '../src/index.js';
import {
  approvalAccount,
  EXPIRES_AT,
  MAX_BUY,
  OWNER_ID,
  POLICY_ID,
  PREDIKT_SIGNER_ID,
  PRIVY_APP_ID,
  PRIVY_WALLET_ID,
  privyPolicy,
  privyWallet,
} from './fixtures.js';
import { json, mockFetch, RecordedCall } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const OWNER_KEY = `wallet-auth:${privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}`;
const PRIVY_SECRET = 'privy-secret';

function options(overrides: Partial<VerifyAndSignApprovalOptions> = {}): VerifyAndSignApprovalOptions {
  return {
    ownerKey: OWNER_KEY,
    privyAppId: PRIVY_APP_ID,
    privyAppSecret: PRIVY_SECRET,
    expected: { privyWalletId: PRIVY_WALLET_ID, maxBuyAmountPerOrder: MAX_BUY, expiresAt: EXPIRES_AT },
    ...overrides,
  };
}

function privy(wallet: unknown = privyWallet(), policy: unknown = privyPolicy()) {
  return mockFetch((call: RecordedCall) => {
    if (call.url.pathname === `/v1/wallets/${PRIVY_WALLET_ID}`) return json(200, wallet);
    if (call.url.pathname === `/v1/policies/${POLICY_ID}`) return json(200, policy);
    return json(404, { error: 'not found' });
  });
}

async function refusal(account: TradingAccount, opts = options()): Promise<ApprovalVerificationError> {
  const error = await verifyAndSignApproval(account, opts).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApprovalVerificationError);
  return error as ApprovalVerificationError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canonicalJson (RFC 8785)', () => {
  it('sorts keys recursively and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x', { d: 2, c: 'é' }] })).toBe(
      '{"a":[true,null,"x",{"c":"é","d":2}],"b":1}',
    );
  });

  it('serializes numbers like ECMAScript and sorts by UTF-16 code units', () => {
    expect(canonicalJson({ 'é': 1, z: 1e21, a: 0.000001, B: -0 })).toBe('{"B":0,"a":0.000001,"z":1e+21,"é":1}');
  });

  it('matches a fixed Privy payload digest', () => {
    const payload = {
      version: 1,
      method: 'PATCH',
      url: 'https://api.privy.io/v1/wallets/w1',
      headers: { 'privy-request-expiry': '1700000000000', 'privy-app-id': 'app' },
      body: { additional_signers: [{ signer_id: 's', override_policy_ids: ['p'] }] },
    };
    const canonical =
      '{"body":{"additional_signers":[{"override_policy_ids":["p"],"signer_id":"s"}]},' +
      '"headers":{"privy-app-id":"app","privy-request-expiry":"1700000000000"},' +
      '"method":"PATCH","url":"https://api.privy.io/v1/wallets/w1","version":1}';
    expect(canonicalJson(payload)).toBe(canonical);
    expect(createHash('sha256').update(canonicalJson(payload)).digest('hex')).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    );
  });

  it('rejects values that are not plain JSON', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson('\uD800')).toThrow(TypeError);
    expect(() => canonicalJson(new Date())).toThrow(TypeError);
    expect(() => canonicalJson(new (class Foo { a = 1 })())).toThrow(TypeError);
    expect(() => canonicalJson(new Map())).toThrow(TypeError);
  });

  it('accepts plain objects from another realm (jest/vm sandboxes) and null-prototype objects', () => {
    const foreign = runInNewContext('JSON.parse(\'{"b":[{"d":1}],"a":"x"}\')');
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    expect(canonicalJson(foreign)).toBe('{"a":"x","b":[{"d":1}]}');
    expect(canonicalJson(Object.assign(Object.create(null), { b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });
});

describe('verifyAndSignApproval', () => {
  it('signs a registration approval that passes every check', async () => {
    const { calls } = privy();
    const account = approvalAccount();

    const signed = await verifyAndSignApproval(account, options());

    expect(signed.approvalDigest).toBe(account.approval!.approvalDigest);
    expect(signed.signatures).toHaveLength(1);
    // Privy verifies ECDSA P-256 / SHA-256 over the canonical JSON, DER-encoded.
    const ok = verify(
      'sha256',
      Buffer.from(canonicalJson(account.approval!.signaturePayload)),
      publicKey,
      Buffer.from(signed.signatures[0], 'base64'),
    );
    expect(ok).toBe(true);
    expect(signed.signatures[0]).toMatch(/^[A-Za-z0-9+/]{80,252}={0,2}$/); // backend DTO pattern

    // The checks read Privy with the integrator's own credentials.
    expect(calls.map((c) => c.url.toString()).sort()).toEqual([
      `https://api.privy.io/v1/policies/${POLICY_ID}`,
      `https://api.privy.io/v1/wallets/${PRIVY_WALLET_ID}`,
    ]);
    for (const call of calls) {
      expect(call.headers['privy-app-id']).toBe(PRIVY_APP_ID);
      expect(call.headers.Authorization).toBe(
        `Basic ${Buffer.from(`${PRIVY_APP_ID}:${PRIVY_SECRET}`).toString('base64')}`,
      );
    }
  });

  it('signs a re-authorization that only re-points Predikt and keeps other signers', async () => {
    const existing = [
      { signer_id: 'casino-ops', override_policy_ids: ['casino-policy'] },
      { signer_id: PREDIKT_SIGNER_ID, override_policy_ids: ['old-v3-policy'] },
    ];
    privy(privyWallet(existing));
    const signed = await verifyAndSignApproval(approvalAccount({ existingSigners: existing }), options());
    expect(signed.signatures).toHaveLength(1);
  });

  it('accepts a PEM owner key and Date expectations', async () => {
    privy();
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const opts = options({ ownerKey: pem });
    opts.expected.expiresAt = new Date(EXPIRES_AT);
    await expect(verifyAndSignApproval(approvalAccount(), opts)).resolves.toBeDefined();
  });

  it('accepts a stricter grant than requested (lower cap, earlier expiry)', async () => {
    privy();
    const opts = options();
    opts.expected.maxBuyAmountPerOrder = '20000000';
    opts.expected.expiresAt = '2028-01-01T00:00:00Z';
    await expect(verifyAndSignApproval(approvalAccount(), opts)).resolves.toBeDefined();
  });

  describe('refuses', () => {
    it('when the account is not awaiting approval', async () => {
      privy();
      const account = { ...approvalAccount(), status: 'active' as const, approval: null };
      expect((await refusal(account)).code).toBe('NOT_AWAITING_APPROVAL');
    });

    it('when the approval is for another wallet', async () => {
      privy();
      const opts = options();
      opts.expected.privyWalletId = 'other-wallet';
      expect((await refusal(approvalAccount(), opts)).code).toBe('WALLET_MISMATCH');
    });

    it('when the payload targets another wallet', async () => {
      privy();
      const account = approvalAccount({
        mutate: (a) => {
          a.signaturePayload.url = 'https://api.privy.io/v1/wallets/someone-else';
        },
      });
      expect((await refusal(account)).code).toBe('WALLET_MISMATCH');
    });

    it('when the approval expired', async () => {
      privy();
      const account = approvalAccount({ mutate: (a) => void (a.expiresAt = new Date(Date.now() - 1).toISOString()) });
      expect((await refusal(account)).code).toBe('APPROVAL_EXPIRED');
    });

    it('when the payload was changed after the digest', async () => {
      privy();
      const account = approvalAccount({
        keepDigest: true,
        mutate: (a) => a.signaturePayload.body.additional_signers.push({ signer_id: 'x', override_policy_ids: [] }),
      });
      expect((await refusal(account)).code).toBe('DIGEST_MISMATCH');
    });

    it.each([
      ['a non-PATCH method', (a: any) => (a.signaturePayload.method = 'POST')],
      ['a body that changes the owner', (a: any) => (a.signaturePayload.body.owner_id = 'attacker')],
      ['a body that changes wallet policies', (a: any) => (a.signaturePayload.body.policy_ids = ['p'])],
      ['an extra payload field', (a: any) => (a.signaturePayload.extra = true)],
      ['another Privy app', (a: any) => (a.signaturePayload.headers['privy-app-id'] = 'other-app')],
      ['an extra header', (a: any) => (a.signaturePayload.headers['privy-idempotency-key'] = 'k')],
      ['a malformed signer', (a: any) => (a.signaturePayload.body.additional_signers[0].extra = 1)],
    ])('a payload with %s', async (_name, mutate) => {
      privy();
      expect((await refusal(approvalAccount({ mutate }))).code).toBe('PAYLOAD_INVALID');
    });

    it('when an existing signer would be removed', async () => {
      privy(privyWallet([{ signer_id: 'casino-ops', override_policy_ids: [] }]));
      expect((await refusal(approvalAccount())).code).toBe('SIGNERS_CHANGED');
    });

    it("when an existing signer's policies would change", async () => {
      const existing = [{ signer_id: 'casino-ops', override_policy_ids: ['casino-policy'] }];
      privy(privyWallet(existing));
      const account = approvalAccount({
        existingSigners: [{ signer_id: 'casino-ops', override_policy_ids: [POLICY_ID] }],
      });
      expect((await refusal(account)).code).toBe('SIGNERS_CHANGED');
    });

    it('when a signer other than Predikt would be added', async () => {
      privy();
      const account = approvalAccount({ existingSigners: [{ signer_id: 'attacker', override_policy_ids: [] }] });
      expect((await refusal(account)).code).toBe('SIGNERS_CHANGED');
    });

    it("when Predikt's signer is not limited to exactly the approved policy", async () => {
      privy();
      const account = approvalAccount({
        mutate: (a) => a.signaturePayload.body.additional_signers[0].override_policy_ids.push('broad-policy'),
      });
      expect((await refusal(account)).code).toBe('SIGNERS_CHANGED');
    });

    it("when Predikt's signer is listed twice", async () => {
      privy();
      const account = approvalAccount({
        mutate: (a) =>
          a.signaturePayload.body.additional_signers.push({ signer_id: PREDIKT_SIGNER_ID, override_policy_ids: [] }),
      });
      expect((await refusal(account)).code).toBe('SIGNERS_CHANGED');
    });

    it('when the wallet owner differs', async () => {
      privy({ ...privyWallet(), owner_id: 'someone-else' });
      expect((await refusal(approvalAccount())).code).toBe('OWNER_MISMATCH');
    });

    it('when the owner is not the expected owner key quorum', async () => {
      privy();
      const opts = options();
      opts.expected.ownerId = 'my-quorum';
      expect((await refusal(approvalAccount(), opts)).code).toBe('OWNER_MISMATCH');
      opts.expected.ownerId = OWNER_ID;
      await expect(verifyAndSignApproval(approvalAccount(), opts)).resolves.toBeDefined();
    });

    it('when the policy is owned by someone else', async () => {
      privy(privyWallet(), { ...privyPolicy(), owner_id: 'predikt' });
      expect((await refusal(approvalAccount())).code).toBe('POLICY_INVALID');
    });

    it.each([
      ['allows transactions', (rules: any[]) => (rules[2].method = 'eth_sendTransaction')],
      ['allows any method', (rules: any[]) => (rules[2].method = '*')],
      ['targets an unknown contract', (rules: any[]) => (rules[2].conditions[1].value = '0x000000000000000000000000000000000000dEaD')],
      ['uses neq on verifyingContract', (rules: any[]) => (rules[2].conditions[1].operator = 'neq')],
      ['has no expiry', (rules: any[]) => rules[3].conditions.pop()],
      ['expires later than requested', (rules: any[]) => (rules[3].conditions.at(-1).value = '4102444800')],
      ['uses lte for the expiry', (rules: any[]) => (rules[3].conditions.at(-1).operator = 'lte')],
      ['has a fake clock condition', (rules: any[]) => (rules[3].conditions.at(-1).field_source = 'ethereum_typed_data_message')],
      ['has an unbound rule', (rules: any[]) => rules.push({ ...rules[2], conditions: [rules[2].conditions[0], rules[2].conditions[2]] })],
      ['has an unknown action', (rules: any[]) => (rules[0].action = 'MAYBE')],
      ['has a Batch rule without a contract', (rules: any[]) => rules[5].conditions.splice(1, 1)],
    ])('when the policy %s', async (_name, mutate) => {
      privy(privyWallet(), privyPolicy(mutate as never));
      expect((await refusal(approvalAccount())).code).toBe('POLICY_INVALID');
    });

    it('when the policy has no rules', async () => {
      privy(privyWallet(), { ...privyPolicy(), rules: [] });
      expect((await refusal(approvalAccount())).code).toBe('POLICY_INVALID');
    });

    it('when the stated buy cap is above the request', async () => {
      privy();
      const opts = options();
      opts.expected.maxBuyAmountPerOrder = '9999999';
      expect((await refusal(approvalAccount(), opts)).code).toBe('LIMITS_EXCEEDED');
    });

    it('when the stated buy cap is missing', async () => {
      privy();
      const account = approvalAccount({ mutate: (a) => void (a.limits.maxBuyAmountPerOrder = null) });
      expect((await refusal(account)).code).toBe('LIMITS_EXCEEDED');
    });

    it('when the stated expiry is later than requested', async () => {
      privy();
      const account = approvalAccount({ mutate: (a) => void (a.limits.expiresAt = '2028-01-01T00:00:00.000Z') });
      expect((await refusal(account)).code).toBe('LIMITS_EXCEEDED');
    });

    it('when Privy cannot be read', async () => {
      mockFetch(() => json(401, { error: 'unauthorized' }));
      expect((await refusal(approvalAccount())).code).toBe('PRIVY_REQUEST_FAILED');
      mockFetch(() => Promise.reject(new TypeError('fetch failed')));
      expect((await refusal(approvalAccount())).code).toBe('PRIVY_REQUEST_FAILED');
    });

    it.each([
      ['garbage', 'not-a-key'],
      ['an RSA key', generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
      ['a secp256k1 key', generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
    ])('with %s as the owner key, without echoing it', async (_name, ownerKey) => {
      const { calls } = privy();
      const error = await refusal(approvalAccount(), options({ ownerKey }));
      expect(error.code).toBe('OWNER_KEY_INVALID');
      expect(error.message).not.toContain(ownerKey);
      expect(calls).toHaveLength(0);
    });
  });

  describe('hardening (adversarial review)', () => {
    const farFuture = (a: any) => {
      a.signaturePayload.headers['privy-request-expiry'] = String(Date.parse('2100-01-01T00:00:00Z'));
      a.expiresAt = '2100-01-01T00:00:00.000Z';
    };

    it.each([
      ['a request expiry decades ahead (replayable update)', farFuture],
      ['a request expiry that differs from the approval expiry', (a: any) => (a.signaturePayload.headers['privy-request-expiry'] = String(Date.now() + 60_000))],
      ['a request expiry a day ahead', (a: any) => {
        const t = Date.now() + 86_400_000;
        a.signaturePayload.headers['privy-request-expiry'] = String(t);
        a.expiresAt = new Date(t).toISOString();
      }],
      ['a non-numeric request expiry', (a: any) => (a.signaturePayload.headers['privy-request-expiry'] = 1e15)],
    ])('refuses %s', async (_name, mutate) => {
      privy();
      expect((await refusal(approvalAccount({ mutate }))).code).toBe('PAYLOAD_INVALID');
    });

    it('pins the Deposit Wallet and Predikt signer when given', async () => {
      privy();
      const opts = options();
      opts.expected.depositWalletAddress = '0x00000000000000000000000000000000DeadBeef';
      expect((await refusal(approvalAccount(), opts)).code).toBe('WALLET_MISMATCH');

      opts.expected.depositWalletAddress = '0xCD466971E81FD723DBEEF85DD37CB3993FF89B38';
      opts.expected.delegatedSignerId = 'casino-ops';
      expect((await refusal(approvalAccount(), opts)).code).toBe('SIGNERS_CHANGED');

      opts.expected.delegatedSignerId = PREDIKT_SIGNER_ID;
      await expect(verifyAndSignApproval(approvalAccount(), opts)).resolves.toBeDefined();
    });

    it.each([
      ['an order rule without chainId', (rules: any[]) => rules[2].conditions.shift()],
      ['an order rule on another chain', (rules: any[]) => (rules[2].conditions[0].value = '1')],
      ['a batch rule without the deadline bound', (rules: any[]) => rules[5].conditions.splice(3, 1)],
      ['a batch deadline after the expiry', (rules: any[]) => (rules[5].conditions[3].value = '4102444800')],
      ['a batch rule for another wallet', (rules: any[]) => (rules[6].conditions[2].value = '0x00000000000000000000000000000000DeadBeef')],
      ['a CLOB login for another address', (rules: any[]) => (rules[0].conditions[1].value = '0x00000000000000000000000000000000DeadBeef')],
      ['a CLOB login with a loose operator', (rules: any[]) => (rules[1].conditions[1].operator = 'starts_with')],
      ['an extra condition with an unknown source', (rules: any[]) => rules[3].conditions.push({ field_source: 'other', field: 'x', operator: 'eq', value: '1' })],
      ['an unknown rule field', (rules: any[]) => (rules[4].extra = true)],
      ['a numeric expiry value', (rules: any[]) => (rules[3].conditions.at(-1).value = Number(rules[3].conditions.at(-1).value))],
      ['a hex expiry value', (rules: any[]) => (rules[3].conditions.at(-1).value = '0x10')],
      ['two expiry conditions', (rules: any[]) => rules[3].conditions.push({ ...rules[3].conditions.at(-1) })],
      ['a conditional DENY rule', (rules: any[]) => rules.push({ name: 'deny', method: 'eth_signTypedData_v4', action: 'DENY', conditions: [] })],
    ])('refuses a policy with %s', async (_name, mutate) => {
      privy(privyWallet(), privyPolicy(mutate as never));
      expect((await refusal(approvalAccount())).code).toBe('POLICY_INVALID');
    });

    it('accepts an unconditional DENY of another method', async () => {
      privy(privyWallet(), privyPolicy((rules: any[]) => rules.push({ name: 'no tx', method: 'eth_sendTransaction', action: 'DENY', conditions: [] })));
      await expect(verifyAndSignApproval(approvalAccount(), options())).resolves.toBeDefined();
    });

    it('refuses when owners are missing rather than comparing undefined', async () => {
      privy({ ...privyWallet(), owner_id: undefined }, { ...privyPolicy(), owner_id: undefined });
      const account = approvalAccount({ mutate: (a: any) => (a.ownerId = undefined) });
      expect((await refusal(account)).code).toBe('PAYLOAD_INVALID');
      privy({ ...privyWallet(), owner_id: null });
      expect((await refusal(approvalAccount())).code).toBe('OWNER_MISMATCH');
    });

    it('refuses when Privy returns no wallet address', async () => {
      privy({ ...privyWallet(), address: undefined });
      expect((await refusal(approvalAccount())).code).toBe('PRIVY_REQUEST_FAILED');
    });
  });

  it('uses the injected fetch for Privy', async () => {
    const injected = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/policies/') ? json(200, privyPolicy()) : json(200, privyWallet()),
    );
    await verifyAndSignApproval(approvalAccount(), options({ fetch: injected as unknown as typeof fetch }));
    expect(injected).toHaveBeenCalledTimes(2);
  });
});
