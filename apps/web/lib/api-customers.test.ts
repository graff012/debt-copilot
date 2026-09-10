import { describe, expect, it } from 'vitest';
import {
  toCustomerDetail,
  toCustomerRows,
  toPromiseBoard,
  type ApiCustomerDetail,
  type ApiCustomerRow,
  type ApiPromiseRow,
} from './api-customers';

const rows: ApiCustomerRow[] = [
  {
    id: 'c1',
    name: 'Mega Shop',
    assignee: 'Aziz R.',
    totals: [{ minor: '1500000000', currency: 'UZS' }],
    overdueDays: 12,
    broken: 2,
    promiseToday: false,
  },
  {
    id: 'c2',
    name: 'Nurline Market',
    assignee: 'Malika T.',
    totals: [{ minor: '100000', currency: 'USD' }],
    overdueDays: 17,
    broken: 0,
    promiseToday: false,
  },
];

const detail: ApiCustomerDetail = {
  customer: { id: 'c1', name: 'Mega Shop', phone: null, taxId: '304819201', assignee: 'Aziz R.' },
  totals: [{ minor: '1500000000', currency: 'UZS' }],
  overdueDays: 12,
  broken: 2,
  invoices: [
    {
      invoiceNumber: 'INV-115',
      dueDate: '2026-08-25',
      remaining: { minor: '1500000000', currency: 'UZS' },
      overdueDays: 12,
    },
    {
      invoiceNumber: 'INV-102',
      dueDate: '2026-09-06',
      remaining: { minor: '300000000', currency: 'UZS' },
      overdueDays: 0,
    },
  ],
  promises: [
    { id: 'p1', amount: { minor: '1000000000', currency: 'UZS' }, promisedDate: '2026-09-04', state: 'broken' },
  ],
  timeline: [{ day: '2026-09-04', kind: 'promise', title: 'Broken promise', body: '', author: '' }],
};

const board: ApiPromiseRow[] = [
  { id: 'p1', customerId: 'c1', customerName: 'Mega', amount: { minor: '1000', currency: 'UZS' }, promisedDate: '2026-09-01', group: 'broken' },
  { id: 'p2', customerId: 'c1', customerName: 'Mega', amount: { minor: '2000', currency: 'UZS' }, promisedDate: '2026-09-06', group: 'today' },
  { id: 'p3', customerId: 'c1', customerName: 'Mega', amount: { minor: '3000', currency: 'UZS' }, promisedDate: '2026-09-10', group: 'upcoming' },
];

describe('toCustomerRows', () => {
  it('converts minors exactly and keeps lanes', () => {
    const out = toCustomerRows(rows);
    expect(out[0]?.totals).toEqual([{ minor: 1_500_000_000n, currency: 'UZS' }]);
    expect(out[1]?.totals).toEqual([{ minor: 100_000n, currency: 'USD' }]);
  });

  it('throws on garbage minors', () => {
    expect(() =>
      toCustomerRows([{ ...rows[0]!, totals: [{ minor: '1.5', currency: 'UZS' }] }]),
    ).toThrow(RangeError);
  });
});

describe('toCustomerDetail', () => {
  it('derives invoice states from fields with the page day', () => {
    const d = toCustomerDetail(detail, '2026-09-06');
    expect(d.invoices.map((i) => [i.invoiceNumber, i.state])).toEqual([
      ['INV-115', 'overdue'],
      ['INV-102', 'due-today'],
    ]);
    expect(d.promises[0]?.state).toBe('broken');
    expect(d.totals).toEqual([{ minor: 1_500_000_000n, currency: 'UZS' }]);
  });

  it('rejects unknown promise states from the wire', () => {
    expect(() =>
      toCustomerDetail(
        { ...detail, promises: [{ ...detail.promises[0]!, state: 'maybe' }] },
        '2026-09-06',
      ),
    ).toThrow(RangeError);
  });
});

describe('toPromiseBoard', () => {
  it('partitions groups and converts amounts', () => {
    const b = toPromiseBoard(board);
    expect(b.broken.map((p) => p.id)).toEqual(['p1']);
    expect(b.dueToday.map((p) => p.id)).toEqual(['p2']);
    expect(b.upcoming.map((p) => p.id)).toEqual(['p3']);
    expect(b.broken[0]?.amountMinor).toBe(1000n);
  });

  it('rejects unknown groups', () => {
    expect(() => toPromiseBoard([{ ...board[0]!, group: 'later' }])).toThrow(RangeError);
  });
});
