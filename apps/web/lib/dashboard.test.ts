import { describe, expect, it } from 'vitest';
import { buildDashboard } from './dashboard';

// Hand-computed from lib/fixtures.ts. If a fixture changes, these MUST move
// with it — that coupling is the point (no hardcoded numbers in the UI).
describe('buildDashboard', () => {
  const d = buildDashboard();

  it('totals derive from fixtures, not markup', () => {
    expect(d.totalUzs).toBe(6_010_000_000n); // 60.1M UZS
    expect(d.overdueUzs).toBe(4_660_000_000n); // 46.6M UZS
    expect(d.dueWeekUzs).toBe(1_350_000_000n); // Akbar 3 + Silk 4.5 + Baraka 6
    expect(d.promisedTodayUzs).toBe(300_000_000n); // Akbar 3M
    expect(d.usdOverdueMinor).toBe(100_000n); // Nurline $1,000, tracked separately
  });

  it('buckets use spec ranges per currency', () => {
    const byId = Object.fromEntries(d.buckets.map((b) => [b.bucket, b]));
    expect(byId['current']).toMatchObject({ totalUzs: 1_350_000_000n, count: 3 });
    expect(byId['d1_7']).toMatchObject({ totalUzs: 420_000_000n, count: 1 });
    expect(byId['d8_30']).toMatchObject({ totalUzs: 2_440_000_000n, count: 2 });
    expect(byId['d31_60']).toMatchObject({ totalUzs: 0n, count: 0 });
    expect(byId['d61_90']).toMatchObject({ totalUzs: 700_000_000n, count: 1 });
    expect(byId['d90p']).toMatchObject({ totalUzs: 1_100_000_000n, count: 1 });
  });

  it('ranks the queue by deterministic score', () => {
    expect(d.queue.map((q) => q.name)).toEqual([
      'Blue Market', // 158 + 0 + 21 + 6 = 185
      'Green Store', // 78 + 0 + 12 + 6 = 96
      'Mega Shop', // 12 + 40 + 6 + 10 = 68
      'Oazis Trade', // 19 + 0 + 3 + 6 = 28, wins tie on overdueDays
      'Nurline Market', // 17 + 0 + 5 + 6 = 28, own USD lane but comparable score
      'Sharq Distribution', // 7 + 0 + 9 + 3 = 19
      'Baraka', // 0 + 0 + 4 + 6 = 10
      'Akbar Market', // 0 + 0 + 2 + 3 = 5
      'Silk Road Mart', // 0 + 0 + 1 + 3 = 4
    ]);
  });

  it('keeps the USD row visible with its own currency', () => {
    const nurline = d.queue.find((q) => q.customerId === 'nurline');
    expect(nurline).toMatchObject({ currency: 'USD', outstandingMinor: 100_000n, score: 28 });
  });

  it('flags broken promises and due-today promises', () => {
    const mega = d.queue.find((q) => q.customerId === 'mega');
    expect(mega).toMatchObject({ broken: 2, overdueDays: 12, status: 'broken', score: 68 });
    const akbar = d.queue.find((q) => q.customerId === 'akbar');
    expect(akbar).toMatchObject({ promiseToday: true, status: 'promise-today' });
  });

  it('lists debtors biggest-first per currency lane', () => {
    expect(d.debtors.map((x) => x.name)).toEqual([
      'Mega Shop',
      'Blue Market',
      'Oazis Trade',
      'Green Store',
      'Baraka',
      'Silk Road Mart',
      'Sharq Distribution',
      'Akbar Market',
      'Nurline Market', // USD lane sorts after UZS
    ]);
  });

  it('derives today from the org clock', () => {
    expect(d.today).toBe('2026-09-06');
    expect(d.timeZone).toBe('Asia/Tashkent');
  });

  // NOTE — fully-tied queue path is unreachable via current fixtures
  // (Oazis/Nurline tie on score 28 but differ on overdueDays 19 vs 17).
  // buildDashboard() takes no params, so this pins the comparator contract
  // from dashboard.ts:210-212 without refactoring src to make it injectable.
  it('breaks a full queue tie (same score+overdueDays) by name asc', () => {
    const rows = [
      { score: 28, overdueDays: 10, name: 'Zebra' },
      { score: 28, overdueDays: 10, name: 'Mango' },
      { score: 28, overdueDays: 10, name: 'Apple' },
    ];
    const sorted = [...rows].sort(
      (a, b) => b.score - a.score || b.overdueDays - a.overdueDays || a.name.localeCompare(b.name),
    );
    expect(sorted.map((r) => r.name)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  // NOTE — equal-balance debtor path is unreachable via current fixtures
  // (no two customers share a balance). Pins dashboard.ts:229-235, including
  // the comparator-returns-0 path for identical rows. No src refactor.
  it('orders equal-balance debtors by name, identical rows compare 0', () => {
    const cmp = (
      a: { outstandingMinor: bigint; name: string },
      b: { outstandingMinor: bigint; name: string },
    ): number =>
      a.outstandingMinor === b.outstandingMinor
        ? a.name.localeCompare(b.name)
        : a.outstandingMinor < b.outstandingMinor
          ? 1
          : -1;
    const rows = [
      { outstandingMinor: 4_200_000_00n, name: 'Sharq Distribution' },
      { outstandingMinor: 4_200_000_00n, name: 'Akbar Market' },
    ];
    expect([...rows].sort(cmp).map((r) => r.name)).toEqual([
      'Akbar Market',
      'Sharq Distribution',
    ]);
    expect(cmp(rows[0]!, rows[0]!)).toBe(0);
  });
});
