import { assertDayString, diffDays, getOrgToday } from './time.js';
import type { Money, OrgContext, Receivable } from './types.js';

export type AgingBucket = 'current' | 'd1_7' | 'd8_30' | 'd31_60' | 'd61_90' | 'd90p';

/** Totals in minor units, grouped per currency. Currencies are never summed together. */
export type AgingSchedule = Record<string, Record<AgingBucket, bigint>>;

const emptyBuckets = (): Record<AgingBucket, bigint> => ({
  current: 0n,
  d1_7: 0n,
  d8_30: 0n,
  d31_60: 0n,
  d61_90: 0n,
  d90p: 0n,
});

const CURRENCY_RE = /^[A-Z]{3}$/;

export function assertCurrencyCode(code: string, field: string): void {
  // Strict ISO shape so "uzs" and "UZS " never silently split buckets.
  if (!CURRENCY_RE.test(code)) {
    throw new RangeError(`${field} must be a 3-letter uppercase code`);
  }
}

export function assertMoney(m: Money, field: string): void {
  if (typeof m.minor !== 'bigint') throw new TypeError(`${field}.minor must be bigint`);
  if (m.minor < 0n) throw new RangeError(`${field}.minor must be >= 0`);
  assertCurrencyCode(m.currency, `${field}.currency`);
}

/** Overdue ⇔ remaining > 0 AND dueDate < today. Due today is NOT overdue. */
export function isOverdue(r: Receivable, today: string): boolean {
  assertDayString(today, 'today');
  assertDayString(r.dueDate, 'dueDate');
  assertMoney(r.remaining, 'remaining');
  return r.remaining.minor > 0n && r.dueDate < today;
}

export function bucketFor(overdueDays: number): AgingBucket {
  if (overdueDays <= 0) return 'current';
  if (overdueDays <= 7) return 'd1_7';
  if (overdueDays <= 30) return 'd8_30';
  if (overdueDays <= 60) return 'd31_60';
  if (overdueDays <= 90) return 'd61_90';
  return 'd90p';
}

export function calculateAging(
  receivables: readonly Receivable[],
  today: string,
  organizationId: string,
): AgingSchedule {
  assertDayString(today, 'today');
  if (!organizationId) throw new RangeError('organizationId is required');
  const out: AgingSchedule = {};
  const seen = new Set<string>();
  for (const r of receivables) {
    // Tenant guard: one org per call, never silently aggregate across orgs.
    if (r.organizationId !== organizationId) {
      throw new RangeError(
        `Receivable ${r.id} belongs to org ${JSON.stringify(r.organizationId)}, expected ${JSON.stringify(organizationId)}`,
      );
    }
    if (seen.has(r.id)) throw new RangeError(`Duplicate receivable id: ${r.id}`);
    seen.add(r.id);
    assertDayString(r.dueDate, 'dueDate');
    assertMoney(r.original, 'original');
    assertMoney(r.remaining, 'remaining');
    if (r.original.currency !== r.remaining.currency) {
      throw new RangeError(
        `Mixed currencies on receivable ${r.id}: ${r.original.currency} vs ${r.remaining.currency}`,
      );
    }
    if (r.remaining.minor > r.original.minor) {
      throw new RangeError(`Remaining exceeds original on receivable ${r.id}`);
    }
    const ccy = r.remaining.currency;
    let row = out[ccy];
    if (!row) {
      row = emptyBuckets();
      out[ccy] = row;
    }
    const bucket = isOverdue(r, today) ? bucketFor(diffDays(r.dueDate, today)) : 'current';
    row[bucket] += r.remaining.minor;
  }
  return out;
}

/**
 * Org-safe entry point: derives today from the org timezone + injected clock,
 * so callers can never inject a server-local date. Prefer this over raw
 * calculateAging at API/bot boundaries.
 */
export function calculateAgingForOrg(
  receivables: readonly Receivable[],
  ctx: OrgContext,
): AgingSchedule {
  return calculateAging(receivables, getOrgToday(ctx), ctx.organizationId);
}
