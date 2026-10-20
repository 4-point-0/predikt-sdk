// Fake Privy API for the e2e script run: serves wallet and policies from FAKE_PRIVY_STATE.
import { readFileSync } from 'node:fs';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://api.privy.io/')) return realFetch(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.get('authorization')?.startsWith('Basic ') || !headers.get('privy-app-id')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const state = JSON.parse(readFileSync(process.env.FAKE_PRIVY_STATE, 'utf8'));
  const path = new URL(url).pathname;
  if (path === `/v1/wallets/${state.wallet.id}`) return Response.json(state.wallet);
  const policy = path.match(/^\/v1\/policies\/(.+)$/);
  if (policy && state.policies[policy[1]]) return Response.json(state.policies[policy[1]]);
  return Response.json({ error: 'not found' }, { status: 404 });
};
