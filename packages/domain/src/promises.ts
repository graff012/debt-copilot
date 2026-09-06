import { assertMoney } from './aging';
import { assertDayString } from './time';
import type { PromiseStatus, PromiseToPay } from './types';

const STATUSES: ReadonlySet<string> = new Set(['OPEN', 'KEPT', 'BROKEN', 'CANCELLED']);

export function assertPromiseStatus(status: string, field: string): asserts status is PromiseStatus {
  if (!STATUSES.has(status)) {
    throw new RangeError(`${field} must be one of OPEN/KEPT/BROKEN/CANCELLED`);
  }
}

/**
 * Broken ⇔ status is OPEN and the promised date has passed. Due today is NOT broken.
 * Note: already-flagged BROKEN rows return false here. Callers counting broken
 * promises for priority must count `status === "BROKEN" || isPromiseBroken(p, today)`.
 */
export function isPromiseBroken(p: PromiseToPay, today: string): boolean {
  assertDayString(today, 'today');
  assertDayString(p.promisedDate, 'promisedDate');
  assertPromiseStatus(p.status, 'status');
  assertMoney(p.amount, 'amount');
  return p.status === 'OPEN' && p.promisedDate < today;
}
