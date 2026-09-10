import { describe, expect, it } from 'vitest';
import { toDashboardData, type ApiDashboard } from './api-dashboard';

// ---------------------------------------------------------------------------
// Adapter passthrough: queue.invoices → queue.invoiceNumbers, exact order,
// bigint minors untouched. Currencies stay in separate lanes.
// NOTE: middleware / api-client / route handlers are untested here (no
// jsdom in web unit scope) — deliberately not forced.
// ---------------------------------------------------------------------------

const dto = (over: Partial<ApiDashboard> = {}): ApiDashboard => ({
  today: '2026-09-06',
  totals: {
    UZS: {
      total: '300000000',
      overdue: '300000000',
      buckets: {
        current: { total: '0', count: 0 },
        d1_7: { total: '0', count: 0 },
        d8_30: { total: '300000000', count: 2 },
        d31_60: { total: '0', count: 0 },
        d61_90: { total: '0', count: 0 },
        d90p: { total: '0', count: 0 },
      },
    },
  },
  dueWeek: {},
  promisedToday: {},
  queue: [
    {
      customerId: 'm1',
      name: 'MultiInv Shop',
      assignee: 'Aziz R.',
      invoices: ['INVNUM-1', 'INVNUM-2'],
      outstanding: { minor: '300000000', currency: 'UZS' },
      overdueDays: 12,
      broken: 0,
      promiseToday: false,
      score: 20,
    },
  ],
  ...over,
});

describe('toDashboardData invoiceNumbers passthrough', () => {
  it('passes multiple invoiceNumbers through in order', () => {
    const d = toDashboardData(dto(), 'Asia/Tashkent');
    expect(d.queue).toHaveLength(1);
    expect(d.queue[0]?.invoiceNumbers).toEqual(['INVNUM-1', 'INVNUM-2']);
    expect(d.queue[0]?.outstandingMinor).toBe(300_000_000n);
    expect(d.queue[0]?.currency).toBe('UZS');
  });

  it('passes a single invoice through untouched', () => {
    const single = dto({
      queue: [
        {
          customerId: 's1',
          name: 'Single Shop',
          assignee: 'Unassigned',
          invoices: ['ONLY-1'],
          outstanding: { minor: '10000000', currency: 'UZS' },
          overdueDays: 0,
          broken: 0,
          promiseToday: false,
          score: 1,
        },
      ],
    });
    const d = toDashboardData(single, 'Asia/Tashkent');
    expect(d.queue[0]?.invoiceNumbers).toEqual(['ONLY-1']);
    expect(d.queue[0]?.outstandingMinor).toBe(10_000_000n);
  });

  it('passes empty invoices through as empty (never null)', () => {
    const empty = dto({
      queue: [
        {
          customerId: 'e1',
          name: 'Empty Shop',
          assignee: 'Unassigned',
          invoices: [],
          outstanding: { minor: '0', currency: 'UZS' },
          overdueDays: 0,
          broken: 0,
          promiseToday: false,
          score: 0,
        },
      ],
    });
    const d = toDashboardData(empty, 'Asia/Tashkent');
    expect(d.queue[0]?.invoiceNumbers).toEqual([]);
    expect(d.queue[0]?.outstandingMinor).toBe(0n);
  });
});
