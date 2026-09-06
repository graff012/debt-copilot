import { describe, expect, it } from 'vitest';
import { bucketFor, calculateAging, calculateAgingForOrg, isOverdue } from '../src/aging.js';
import type { Receivable } from '../src/types.js';

const uzs = (minor: bigint) => ({ minor, currency: 'UZS' });
const usd = (minor: bigint) => ({ minor, currency: 'USD' });

const rec = (over: Partial<Receivable> = {}): Receivable => ({
  id: 'r1',
  organizationId: 'o1',
  customerId: 'c1',
  invoiceNumber: 'INV-1',
  dueDate: '2026-08-22',
  original: uzs(15_000_000_00n),
  remaining: uzs(15_000_000_00n),
  ...over,
});

describe('isOverdue', () => {
  it('is false when due today', () => {
    expect(isOverdue(rec({ dueDate: '2026-09-06' }), '2026-09-06')).toBe(false);
  });

  it('is true 1 day overdue', () => {
    expect(isOverdue(rec({ dueDate: '2026-09-05' }), '2026-09-06')).toBe(true);
  });

  it('is false for future due dates', () => {
    expect(isOverdue(rec({ dueDate: '2026-09-10' }), '2026-09-06')).toBe(false);
  });

  it('is false when nothing remains, even past due', () => {
    expect(isOverdue(rec({ dueDate: '2026-08-01', remaining: uzs(0n) }), '2026-09-06')).toBe(false);
  });

  it('applies the same rule to USD receivables without conversion', () => {
    const usdRec = rec({
      dueDate: '2026-09-05',
      original: usd(1_000_00n),
      remaining: usd(1_000_00n),
    });
    expect(isOverdue(usdRec, '2026-09-06')).toBe(true);
    expect(isOverdue({ ...usdRec, dueDate: '2026-09-06' }, '2026-09-06')).toBe(false);
    expect(isOverdue({ ...usdRec, remaining: usd(0n) }, '2026-09-06')).toBe(false);
  });

  it('rejects empty currency via assertMoney instead of miscomparing dates', () => {
    const bad = rec({
      dueDate: '2026-09-05',
      original: { minor: 1n, currency: '' },
      remaining: { minor: 1n, currency: '' },
    });
    expect(() => isOverdue(bad, '2026-09-06')).toThrow(RangeError);
  });

  it('handles leap day due dates', () => {
    expect(isOverdue(rec({ dueDate: '2024-02-29' }), '2024-03-01')).toBe(true);
    expect(isOverdue(rec({ dueDate: '2024-02-29' }), '2024-02-29')).toBe(false);
  });
});

describe('bucketFor', () => {
  it.each([
    [0, 'current'],
    [1, 'd1_7'],
    [7, 'd1_7'],
    [8, 'd8_30'],
    [30, 'd8_30'],
    [31, 'd31_60'],
    [60, 'd31_60'],
    [61, 'd61_90'],
    [90, 'd61_90'],
    [91, 'd90p'],
    [400, 'd90p'],
  ] as const)('%i days → %s', (days, bucket) => {
    expect(bucketFor(days)).toBe(bucket);
  });

  it('caps huge overdue counts at d90p without overflow', () => {
    expect(bucketFor(1_000_000)).toBe('d90p');
    expect(bucketFor(Number.MAX_SAFE_INTEGER)).toBe('d90p');
  });
});

describe('calculateAging', () => {
  it('returns empty schedule for no receivables', () => {
    expect(calculateAging([], '2026-09-06', 'o1')).toEqual({});
  });

  it('totals per currency without mixing', () => {
    const out = calculateAging(
      [
        rec({ id: 'a', dueDate: '2026-08-25', remaining: uzs(3_000_000_00n) }), // 12d → d8_30
        rec({ id: 'b', dueDate: '2026-09-10', remaining: uzs(6_000_000_00n) }), // current
        rec({
          id: 'c',
          dueDate: '2026-08-25',
          original: usd(1_000_00n),
          remaining: usd(1_000_00n),
        }),
      ],
      '2026-09-06',
      'o1',
    );
    expect(out['UZS']).toEqual({
      current: 6_000_000_00n,
      d1_7: 0n,
      d8_30: 3_000_000_00n,
      d31_60: 0n,
      d61_90: 0n,
      d90p: 0n,
    });
    expect(out['USD']?.d8_30).toBe(1_000_00n);
  });

  it('throws on mixed currencies within one receivable', () => {
    expect(() =>
      calculateAging([rec({ original: uzs(1n), remaining: usd(1n) })], '2026-09-06', 'o1'),
    ).toThrow(RangeError);
  });

  it('throws on negative remaining instead of silently netting', () => {
    expect(() =>
      calculateAging([rec({ remaining: { minor: -1n, currency: 'UZS' } })], '2026-09-06', 'o1'),
    ).toThrow(RangeError);
  });

  it('throws on cross-org rows instead of aggregating tenants', () => {
    expect(() =>
      calculateAging(
        [rec({ id: 'a' }), rec({ id: 'b', organizationId: 'o2' })],
        '2026-09-06',
        'o1',
      ),
    ).toThrow(RangeError);
  });

  it('throws on empty organizationId', () => {
    expect(() => calculateAging([rec()], '2026-09-06', '')).toThrow(RangeError);
  });

  it('throws on duplicate ids instead of double-counting', () => {
    expect(() => calculateAging([rec({ id: 'a' }), rec({ id: 'a' })], '2026-09-06', 'o1')).toThrow(
      RangeError,
    );
  });

  it('throws when remaining exceeds original', () => {
    expect(() =>
      calculateAging(
        [rec({ original: uzs(5_000_000_00n), remaining: uzs(8_000_000_00n) })],
        '2026-09-06',
        'o1',
      ),
    ).toThrow(RangeError);
  });

  it('rejects non-canonical currency codes', () => {
    for (const currency of ['uzs', 'UZS ', 'US', 'USDD', '']) {
      expect(() =>
        calculateAging(
          [rec({ original: { minor: 1n, currency }, remaining: { minor: 1n, currency } })],
          '2026-09-06',
          'o1',
        ),
      ).toThrow(RangeError);
    }
  });

  it('rejects impossible calendar days instead of misbucketing', () => {
    for (const dueDate of ['2026-02-30', '2026-13-01', '2026-00-10']) {
      expect(() => calculateAging([rec({ dueDate })], '2026-09-06', 'o1')).toThrow(RangeError);
    }
  });

  it('emits a full zero-bucket shape when everything is current', () => {
    const out = calculateAging(
      [
        rec({ id: 'a', dueDate: '2026-09-06', remaining: uzs(2_000_000_00n) }),
        rec({ id: 'b', dueDate: '2026-09-10', remaining: uzs(3_000_000_00n) }),
      ],
      '2026-09-06',
      'o1',
    );
    expect(out['UZS']).toEqual({
      current: 5_000_000_00n,
      d1_7: 0n,
      d8_30: 0n,
      d31_60: 0n,
      d61_90: 0n,
      d90p: 0n,
    });
  });
});

describe('calculateAgingForOrg', () => {
  it('derives today from the org timezone, not server time', () => {
    // 19:30Z Sep 6 = 00:30 Sep 7 in Tashkent → 1 day overdue → d1_7.
    const out = calculateAgingForOrg([rec({ dueDate: '2026-09-06' })], {
      organizationId: 'o1',
      timeZone: 'Asia/Tashkent',
      now: new Date('2026-09-06T19:30:00Z'),
    });
    expect(out['UZS']?.d1_7).toBe(15_000_000_00n);
  });

  it('rejects rows from another org', () => {
    expect(() =>
      calculateAgingForOrg([rec()], {
        organizationId: 'o2',
        timeZone: 'Asia/Tashkent',
        now: new Date('2026-09-06T12:00:00Z'),
      }),
    ).toThrow(RangeError);
  });

  it('proves org-dependence: same instant is overdue in Tashkent but current in UTC', () => {
    // 19:30Z Sep 6 = 00:30 Sep 7 in Tashkent (due Sep 6 → 1d overdue) but still Sep 6 in UTC (due today → current).
    const now = new Date('2026-09-06T19:30:00Z');
    const rows = [rec({ dueDate: '2026-09-06' })];
    const tashkent = calculateAgingForOrg(rows, {
      organizationId: 'o1',
      timeZone: 'Asia/Tashkent',
      now,
    });
    const utc = calculateAgingForOrg(rows, {
      organizationId: 'o1',
      timeZone: 'UTC',
      now,
    });
    expect(tashkent['UZS']?.d1_7).toBe(15_000_000_00n);
    expect(tashkent['UZS']?.current).toBe(0n);
    expect(utc['UZS']?.current).toBe(15_000_000_00n);
    expect(utc['UZS']?.d1_7).toBe(0n);
  });
});
