// `@prediktgg/sdk/server` — Node-only helpers that use the integrator's secrets (owner key,
// Privy App Secret). Kept out of the main entry so browser bundles never pull in `node:crypto`.
export {
  verifyAndSignApproval,
  ApprovalVerificationError,
  POLYMARKET_EXCHANGES,
} from './approval/verify-and-sign.js';
export type { ApprovalCheckCode, VerifyAndSignApprovalOptions } from './approval/verify-and-sign.js';
export { canonicalJson } from './approval/canonical-json.js';
