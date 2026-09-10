import { describe, expect, it } from 'vitest';
import { toCustomerDetail, toPromiseBoard, type ApiCustomerDetail } from './api-customers';

// ---------------------------------------------------------------------------
// api-customers missing pins (companion to api-customers.test.ts, fresh
// minimal inputs — none of that file's rows/detail/board fixtures reused):
// - promise group contract: 'today' accepted, 'due-today' rejected (live 500)
// - invoice paid via BigInt compare: minor '00' → 'paid'
// - timeline passthrough keeps day/kind/title (no wire state for invoices)
// Money asserts: bigint minor units, UZS/USD never mixed.
// ---------------------------------------------------------------------------

describe('toPromiseBoard group contract', () => {
  it("accepts group 'today' into dueToday", () => {
    const b = toPromiseBoard([
      {
        id: 'ct1',
        customerId: 'c1',
        customerName: 'Contract Shop',
        amount: { minor: '7000', currency: 'UZS' },
        promisedDate: '2026-09-06',
        group: 'today',
      },
    ]);
    expect(b.dueToday.map((p) => p.id)).toEqual(['ct1']);
    expect(b.dueToday[0]?.amountMinor).toBe(7_000n);
    expect(b.broken).toEqual([]);
    expect(b.upcoming).toEqual([]);
  });

  it("rejects group 'due-today' with RangeError (regression pin for the live 500)", () => {
    expect(() =>
      toPromiseBoard([
        {
          id: 'ct2',
          customerId: 'c1',
          customerName: 'Contract Shop',
          amount: { minor: '7000', currency: 'UZS' },
          promisedDate: '2026-09-06',
          group: 'due-today',
        },
      ]),
    ).toThrow(RangeError);
  });
});

const paidDetail = (minor: string): ApiCustomerDetail => ({
  customer: { id: 'cp1', name: 'Paid Shop', phone: null, taxId: null, assignee: 'Unassigned' },
  totals: [{ minor, currency: 'UZS' }],
  overdueDays: 0,
  broken: 0,
  invoices: [
    {
      invoiceNumber: 'PAID-1',
      dueDate: '2026-08-25',
      remaining: { minor, currency: 'UZS' },
      overdueDays: 0,
    },
  ],
  promises: [],
  timeline: [],
});

describe('toCustomerDetail paid derivation', () => {
  it("maps remaining minor '00' to state 'paid' (BigInt, not string compare)", () => {
    const d = toCustomerDetail(paidDetail('00'), '2026-09-06');
    expect(d.invoices[0]?.state).toBe('paid');
    expect(d.invoices[0]?.remainingMinor).toBe(0n);
  });

  it("maps remaining minor '0' to state 'paid'", () => {
    const d = toCustomerDetail(paidDetail('0'), '2026-09-06');
    expect(d.invoices[0]?.state).toBe('paid');
    expect(d.invoices[0]?.remainingMinor).toBe(0n);
  });
});

describe('toCustomerDetail timeline passthrough', () => {
  it('keeps day/kind/title (plus body/author) untouched', () => {
    const api: ApiCustomerDetail = {
      customer: { id: 'ct3', name: 'Timeline Shop', phone: null, taxId: null, assignee: 'Unassigned' },
      totals: [{ minor: '500000', currency: 'USD' }],
      overdueDays: 0,
      broken: 0,
      invoices: [],
      promises: [],
      timeline: [
        { day: '2026-09-04', kind: 'promise', title: 'Promise ct3', body: 'call back', author: 'Amina' },
        { day: '2026-09-05', kind: 'note', title: 'Called', body: 'no answer', author: '' },
      ],
    };
    const d = toCustomerDetail(api, '2026-09-06');
    expect(d.timeline).toEqual([
      { day: '2026-09-04', kind: 'promise', title: 'Promise ct3', body: 'call back', author: 'Amina' },
      { day: '2026-09-05', kind: 'note', title: 'Called', body: 'no answer', author: '' },
    ]);
    // Single-currency lane stays exact, bigint-only.
    expect(d.totals).toEqual([{ minor: 500_000n, currency: 'USD' }]);
  });
});
