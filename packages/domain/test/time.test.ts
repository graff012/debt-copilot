import { describe, expect, it } from 'vitest';
import { addDays, diffDays, getOrgToday } from '../src/time';

const TASHKENT = 'Asia/Tashkent';

describe('getOrgToday', () => {
  it('resolves the org-local day behind UTC (23:30 +05:00)', () => {
    expect(
      getOrgToday({ organizationId: 'o1', timeZone: TASHKENT, now: new Date('2026-09-06T18:30:00Z') }),
    ).toBe('2026-09-06');
  });

  it('flips the day at the org midnight, not server midnight', () => {
    // 19:30Z = 00:30 next day in Tashkent; a UTC-based calc would say Sep 6.
    expect(
      getOrgToday({ organizationId: 'o1', timeZone: TASHKENT, now: new Date('2026-09-06T19:30:00Z') }),
    ).toBe('2026-09-07');
  });

  it('rejects invalid guards', () => {
    const ok = { organizationId: 'o1', timeZone: TASHKENT, now: new Date('2026-09-06T12:00:00Z') };
    expect(() => getOrgToday({ ...ok, organizationId: '' })).toThrow(RangeError);
    expect(() => getOrgToday({ ...ok, timeZone: '' })).toThrow(RangeError);
    expect(() => getOrgToday({ ...ok, timeZone: 'Mars/Olympus' })).toThrow(RangeError);
    expect(() => getOrgToday({ ...ok, now: new Date(NaN) })).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('shifts across month and leap boundaries', () => {
    expect(addDays('2026-01-20', 15)).toBe('2026-02-04');
    expect(addDays('2024-02-15', 15)).toBe('2024-03-01'); // leap year
    expect(addDays('2026-09-06', -5)).toBe('2026-09-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('shifts negative across the year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-01-05', -10)).toBe('2025-12-26');
  });

  it('rejects bad input', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2026-09-06', 1.5)).toThrow(RangeError);
    expect(() => addDays('2026-09-06', Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});

describe('diffDays', () => {
  it('counts whole calendar days', () => {
    expect(diffDays('2026-09-01', '2026-09-01')).toBe(0);
    expect(diffDays('2026-09-01', '2026-09-02')).toBe(1);
    expect(diffDays('2024-02-29', '2024-03-01')).toBe(1); // leap day
  });

  it('goes negative when fromDay is after toDay', () => {
    expect(diffDays('2026-09-06', '2026-09-01')).toBe(-5);
    expect(diffDays('2026-09-02', '2026-09-01')).toBe(-1);
  });

  it('crosses the year boundary in both directions', () => {
    expect(diffDays('2025-12-31', '2026-01-01')).toBe(1);
    expect(diffDays('2026-01-01', '2025-12-31')).toBe(-1);
    expect(diffDays('2025-12-30', '2026-01-02')).toBe(3);
  });

  it('rejects non-day strings', () => {
    expect(() => diffDays('2026-9-1', '2026-09-02')).toThrow(RangeError);
    expect(() => diffDays('2026-09-01', 'tomorrow')).toThrow(RangeError);
  });
});
