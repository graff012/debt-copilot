import { describe, expect, it } from 'vitest';
import { isPromiseBroken } from '../src/promises.js';
import type { PromiseToPay } from '../src/types.js';

const promise = (over: Partial<PromiseToPay> = {}): PromiseToPay => ({
  id: 'p1',
  organizationId: 'o1',
  customerId: 'c1',
  amount: { minor: 10_000_000_00n, currency: 'UZS' },
  promisedDate: '2026-09-04',
  status: 'OPEN',
  ...over,
});

describe('isPromiseBroken', () => {
  it('is true when OPEN and the date has passed', () => {
    expect(isPromiseBroken(promise(), '2026-09-06')).toBe(true);
  });

  it('is false when due today', () => {
    expect(isPromiseBroken(promise({ promisedDate: '2026-09-06' }), '2026-09-06')).toBe(false);
  });

  it('is false when kept, even past date', () => {
    expect(isPromiseBroken(promise({ status: 'KEPT' }), '2026-09-06')).toBe(false);
  });

  it('is false when cancelled or already marked broken', () => {
    expect(isPromiseBroken(promise({ status: 'CANCELLED' }), '2026-09-06')).toBe(false);
    // Already-flagged rows are not *newly* broken: counters must use
    // status === "BROKEN" || isPromiseBroken(p, today).
    expect(isPromiseBroken(promise({ status: 'BROKEN' }), '2026-09-06')).toBe(false);
  });

  it('throws on unknown status instead of silently returning false', () => {
    const bad = promise({ status: 'MAYBE' as unknown as PromiseToPay['status'] });
    expect(() => isPromiseBroken(bad, '2026-09-06')).toThrow(RangeError);
  });

  it('throws on non-bigint amount', () => {
    const bad = promise({ amount: { minor: 100 as unknown as bigint, currency: 'UZS' } });
    expect(() => isPromiseBroken(bad, '2026-09-06')).toThrow(TypeError);
  });

  it('counts BROKEN as status === "BROKEN" || isPromiseBroken(p, today)', () => {
    const today = '2026-09-06';
    const rows = [
      promise({ id: 'flagged', status: 'BROKEN', promisedDate: '2026-09-04' }),
      promise({ id: 'fresh', status: 'OPEN', promisedDate: '2026-09-04' }),
      promise({ id: 'future', status: 'OPEN', promisedDate: '2026-09-10' }),
      promise({ id: 'kept', status: 'KEPT', promisedDate: '2026-09-04' }),
    ];
    const broken = rows.filter((p) => p.status === 'BROKEN' || isPromiseBroken(p, today));
    expect(broken.map((p) => p.id)).toEqual(['flagged', 'fresh']);
    expect(broken).toHaveLength(2);
  });
});
