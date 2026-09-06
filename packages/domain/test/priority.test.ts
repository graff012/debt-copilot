import { describe, expect, it } from 'vitest';
import { amountTierFor, calculatePriority } from '../src/priority';

describe('calculatePriority', () => {
  it('sums overdue + broken×20 + no-contact + tier', () => {
    // Mega Shop shape: 12d overdue, 2 broken, 6d no contact, tier 6 (e.g. 8M UZS)
    expect(
      calculatePriority({ overdueDays: 12, brokenPromises: 2, noContactDays: 6, amountTier: 6 }),
    ).toBe(64);
  });

  it('lets broken promises dominate recency', () => {
    const broken = calculatePriority({
      overdueDays: 1,
      brokenPromises: 1,
      noContactDays: 0,
      amountTier: 0,
    });
    const stale = calculatePriority({
      overdueDays: 10,
      brokenPromises: 0,
      noContactDays: 5,
      amountTier: 0,
    });
    expect(broken).toBeGreaterThan(stale);
  });

  it('rejects negative counts', () => {
    expect(() =>
      calculatePriority({ overdueDays: -1, brokenPromises: 0, noContactDays: 0, amountTier: 0 }),
    ).toThrow(RangeError);
  });

  it('rejects non-integer, NaN, Infinity, and out-of-range tiers', () => {
    const base = { overdueDays: 1, brokenPromises: 0, noContactDays: 0, amountTier: 0 };
    expect(() => calculatePriority({ ...base, overdueDays: 1.5 })).toThrow(RangeError);
    expect(() => calculatePriority({ ...base, overdueDays: NaN })).toThrow(RangeError);
    expect(() => calculatePriority({ ...base, noContactDays: Infinity })).toThrow(RangeError);
    expect(() => calculatePriority({ ...base, amountTier: 16 })).toThrow(RangeError);
    expect(() => calculatePriority({ ...base, amountTier: 15 })).not.toThrow();
  });
});

describe('amountTierFor', () => {
  it('tiers UZS exposure without conversion', () => {
    expect(amountTierFor({ minor: 500_000_00n, currency: 'UZS' })).toBe(0); // 0.5M
    expect(amountTierFor({ minor: 3_000_000_00n, currency: 'UZS' })).toBe(3);
    expect(amountTierFor({ minor: 15_000_000_00n, currency: 'UZS' })).toBe(10);
    expect(amountTierFor({ minor: 100_000_000_00n, currency: 'UZS' })).toBe(15);
  });

  it('tiers USD on its own scale', () => {
    expect(amountTierFor({ minor: 50_00n, currency: 'USD' })).toBe(0);
    expect(amountTierFor({ minor: 1_000_00n, currency: 'USD' })).toBe(6);
  });

  it('returns 0 for zero and for unknown currencies', () => {
    expect(amountTierFor({ minor: 0n, currency: 'UZS' })).toBe(0);
    expect(amountTierFor({ minor: 999_999_999n, currency: 'EUR' })).toBe(0);
  });

  it('hits exact tier boundaries', () => {
    expect(amountTierFor({ minor: 100_000_000n - 1n, currency: 'UZS' })).toBe(0);
    expect(amountTierFor({ minor: 100_000_000n, currency: 'UZS' })).toBe(3); // exactly 1M
    expect(amountTierFor({ minor: 1_500_000_000n, currency: 'UZS' })).toBe(10); // exactly 15M
    expect(amountTierFor({ minor: 5_000_000_000n, currency: 'UZS' })).toBe(15); // exactly 50M
    expect(amountTierFor({ minor: 10_000n, currency: 'USD' })).toBe(3); // exactly $100
  });

  it('throws on negative or non-bigint amounts', () => {
    expect(() => amountTierFor({ minor: -1n, currency: 'UZS' })).toThrow(RangeError);
    expect(() =>
      amountTierFor({ minor: 100 as unknown as bigint, currency: 'UZS' }),
    ).toThrow(TypeError);
  });

  it('stays in the lower tier just below each boundary', () => {
    // UZS limits: 100M / 500M / 1500M / 5000M minor (tiyin).
    expect(amountTierFor({ minor: 500_000_000n - 1n, currency: 'UZS' })).toBe(3);
    expect(amountTierFor({ minor: 1_500_000_000n - 1n, currency: 'UZS' })).toBe(6);
    expect(amountTierFor({ minor: 5_000_000_000n - 1n, currency: 'UZS' })).toBe(10);
    // USD limits: 10k / 50k / 150k / 500k cents.
    expect(amountTierFor({ minor: 10_000n - 1n, currency: 'USD' })).toBe(0);
    expect(amountTierFor({ minor: 50_000n - 1n, currency: 'USD' })).toBe(3);
    expect(amountTierFor({ minor: 150_000n - 1n, currency: 'USD' })).toBe(6);
    expect(amountTierFor({ minor: 500_000n - 1n, currency: 'USD' })).toBe(10);
  });
});
