import { ComboOrder } from '../types/combos.js';
import { DirectOrder, TradingAccount } from '../types/direct.js';

/**
 * True while a re-authorization awaits the owner's approval and the account still trades under
 * its previous grant (`activeGrant`). Not true for a first registration awaiting approval.
 */
export function isReauthorizationPending(account: TradingAccount): boolean {
  // `!!`: responses from API versions before `activeGrant` existed lack the field.
  return account.status === 'awaiting_owner_approval' && !!account.activeGrant;
}

/**
 * True when a direct order will not change any more: `rejected`, or `filled`/`redeemed` with its
 * settlement amount set (`spentAmount` for buys, `receivedAmount` otherwise). A `filled` order can
 * briefly have null amounts; keep polling until they are set.
 */
export function isDirectOrderFinal(order: DirectOrder): boolean {
  if (order.status === 'rejected') return true;
  if (order.status !== 'filled' && order.status !== 'redeemed') return false;
  return (order.side === 'buy' ? order.spentAmount : order.receivedAmount) !== null;
}

/** True for `FILLED` and `FAILED` combo orders. */
export function isComboOrderFinal(order: ComboOrder): boolean {
  return order.status === 'FILLED' || order.status === 'FAILED';
}
