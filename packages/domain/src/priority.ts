import { assertMoney } from './aging';
import type { Money } from './types';

/**
 * V1 heuristic exposure tiers, per currency, compared in minor units.
 * Unknown currency → 0 (no guessing, no conversion).
 * Assumes 2 minor digits (tiyin/cents).
 */
const TIERS: Record<string, ReadonlyArray<readonly [bigint, number]>> = {
  UZS: [
    [100_000_000n, 0], // < 1M
    [500_000_000n, 3], // 1–5M
    [1_500_000_000n, 6], // 5–15M
    [5_000_000_000n, 10], // 15–50M, above → 15
  ],
  USD: [
    [10_000n, 0], // < $100
    [50_000n, 3], // $100–500
    [150_000n, 6], // $500–1500
    [500_000n, 10], // $1500–5000, above → 15
  ],
};

const MAX_TIER = 15;

export function amountTierFor(m: Money): number {
  assertMoney(m, 'amount');
  const tiers = TIERS[m.currency];
  if (!tiers) return 0;
  for (const [limit, tier] of tiers) {
    if (m.minor < limit) return tier;
  }
  return MAX_TIER;
}

export interface PriorityInput {
  readonly overdueDays: number;
  readonly brokenPromises: number;
  readonly noContactDays: number;
  readonly amountTier: number;
}

function assertCount(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be an integer >= 0`);
  }
}

/** Deterministic V1 score: overdue×1 + broken×20 + no-contact + amount tier. Higher = call first. */
export function calculatePriority(i: PriorityInput): number {
  assertCount(i.overdueDays, 'overdueDays');
  assertCount(i.brokenPromises, 'brokenPromises');
  assertCount(i.noContactDays, 'noContactDays');
  assertCount(i.amountTier, 'amountTier');
  if (i.amountTier > MAX_TIER) throw new RangeError(`amountTier must be <= ${MAX_TIER}`);
  return i.overdueDays + i.brokenPromises * 20 + i.noContactDays + i.amountTier;
}
