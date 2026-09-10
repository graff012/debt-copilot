import { describe, expect, it } from 'vitest';
import { toDashboardData, type ApiDashboard } from './api-dashboard';

const dto = (over: Partial<ApiDashboard> = {}): ApiDashboard => ({
  today: '2026-09-06',
  totals: {
    UZS: {
      total: '6010000000',
      overdue: '4660000000',
      buckets: {
        current: { total: '1350000000', count: 3 },
        d1_7: { total: '420000000', count: 1 },
        d8_30: { total: '2440000000', count: 2 },
        d31_60: { total: '0', count: 0 },
        d61_90: { total: '700000000', count: 1 },
        d90p: { total: '1100000000', count: 1 },
      },
    },
    USD: {
      total: '100000',
      overdue: '100000',
      buckets: {
        current: { total: '0', count: 0 },
        d1_7: { total: '0', count: 0 },
        d8_30: { total: '100000', count: 1 },
        d31_60: { total: '0', count: 0 },
        d61_90: { total: '0', count: 0 },
        d90p: { total: '0', count: 0 },
      },
    },
  },
  dueWeek: { UZS: '1350000000' },
  promisedToday: { UZS: '300000000' },
  queue: [
    {
      customerId: 'm1',
      name: 'Mega Shop',
      assignee: 'Aziz R.',
      invoices: ['INV-115'],
      outstanding: { minor: '1500000000', currency: 'UZS' },
      overdueDays: 12,
      broken: 2,
      promiseToday: false,
      score: 68,
    },
    {
      customerId: 'n1',
      name: 'Nurline Market',
      assignee: 'Malika T.',
      invoices: ['INV-200'],
      outstanding: { minor: '100000', currency: 'USD' },
      overdueDays: 17,
      broken: 0,
      promiseToday: false,
      score: 28,
    },
  ],
  ...over,
});

describe('toDashboardData', () => {
  it('converts string minors to exact bigint (never float)', () => {
    const d = toDashboardData(dto(), 'Asia/Tashkent');
    expect(d.totalUzs).toBe(6_010_000_000n);
    expect(d.overdueUzs).toBe(4_660_000_000n);
    expect(d.dueWeekUzs).toBe(1_350_000_000n);
    expect(d.promisedTodayUzs).toBe(300_000_000n);
    expect(d.usdOverdueMinor).toBe(100_000n);
    expect(d.buckets.find((b) => b.bucket === 'd8_30')).toMatchObject({
      totalUzs: 2_440_000_000n,
      count: 2,
    });
  });

  it('derives queue status and keeps currencies separate', () => {
    const d = toDashboardData(dto(), 'Asia/Tashkent');
    expect(d.queue.map((q) => [q.name, q.status])).toEqual([
      ['Mega Shop', 'broken'],
      ['Nurline Market', 'overdue'],
    ]);
    expect(d.queue[0]?.invoiceNumbers).toEqual(['INV-115']);
    expect(d.debtors.map((x) => x.name)).toEqual(['Mega Shop', 'Nurline Market']);
  });

  it('throws on non-integer minors instead of rendering garbage', () => {
    expect(() =>
      toDashboardData(
        dto({ totals: { UZS: { total: 'abc', overdue: '0', buckets: {} } } }),
        'Asia/Tashkent',
      ),
    ).toThrow(RangeError);
  });
});
