import { describe, expect, it } from 'vitest';
import { buildCustomerDetail, buildCustomerList } from './customers';

describe('buildCustomerDetail', () => {
  const mega = buildCustomerDetail('mega');

  it('aggregates the account from domain primitives', () => {
    expect(mega).toMatchObject({
      name: 'Mega Shop',
      assignee: 'Aziz R.',
      currency: 'UZS',
      outstandingMinor: 1_500_000_000n,
      overdueDays: 12,
      broken: 2,
    });
    expect(mega.invoices).toHaveLength(1);
    expect(mega.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-115',
      overdueDays: 12,
      state: 'overdue',
    });
  });

  it('orders promises oldest-first with broken states', () => {
    expect(mega.promises.map((p) => p.id)).toEqual(['p-mega-2', 'p-mega-1']);
    expect(mega.promises.map((p) => p.state)).toEqual(['broken', 'broken']);
  });

  it('merges derived events with human notes, newest first', () => {
    expect(mega.timeline.map((e) => e.day)).toEqual([
      '2026-09-04',
      '2026-09-02',
      '2026-09-01',
      '2026-08-30',
      '2026-08-26',
      '2026-08-01',
    ]);
    expect(mega.timeline.map((e) => e.kind)).toEqual([
      'promise',
      'promise',
      'note',
      'call',
      'overdue',
      'invoice',
    ]);
  });

  it('throws on unknown customers (route maps to notFound)', () => {
    expect(() => buildCustomerDetail('nope')).toThrow(RangeError);
  });
});

describe('buildCustomerList', () => {
  it('ranks like the dashboard queue, same tiebreaks', () => {
    const rows = buildCustomerList();
    expect(rows.map((r) => r.name)).toEqual([
      'Blue Market',
      'Green Store',
      'Mega Shop',
      'Oazis Trade',
      'Nurline Market',
      'Sharq Distribution',
      'Baraka',
      'Akbar Market',
      'Silk Road Mart',
    ]);
    expect(rows).toHaveLength(9);
  });

  it('flags promiseToday true for akbar, false for blue', () => {
    const rows = buildCustomerList();
    const akbar = rows.find((r) => r.customerId === 'akbar');
    const blue = rows.find((r) => r.customerId === 'blue');
    expect(akbar?.promiseToday).toBe(true);
    expect(blue?.promiseToday).toBe(false);
  });
});

describe('invoice states (due-today / upcoming / paid)', () => {
  it('marks akbar INV-102 due-today with zero overdue days', () => {
    const akbar = buildCustomerDetail('akbar');
    expect(akbar.invoices).toHaveLength(1);
    expect(akbar.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-102',
      dueDate: '2026-09-06',
      currency: 'UZS',
      overdueDays: 0,
      state: 'due-today',
    });
    // bigint minor units, never float.
    expect(akbar.invoices[0]?.originalMinor).toBe(800_000_000n);
    expect(akbar.invoices[0]?.remainingMinor).toBe(300_000_000n);
  });

  it('marks baraka INV-130 upcoming', () => {
    const baraka = buildCustomerDetail('baraka');
    expect(baraka.invoices).toHaveLength(1);
    expect(baraka.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-130',
      dueDate: '2026-09-09',
      currency: 'UZS',
      overdueDays: 0,
      state: 'upcoming',
    });
    expect(baraka.invoices[0]?.originalMinor).toBe(600_000_000n);
    expect(baraka.invoices[0]?.remainingMinor).toBe(600_000_000n);
  });

  // NOTE — paid state is unreachable via current fixtures: no receivable has
  // remaining.minor === 0n (customers.ts:132-133 derives paid only from 0n).
  // Not forced with a synthetic fixture; pinning the gap instead of faking it.
  it('notes paid state untestable: no fixture has 0n remaining', () => {
    const rows = buildCustomerList();
    for (const row of rows) {
      const d = buildCustomerDetail(row.customerId);
      for (const inv of d.invoices) {
        expect(inv.remainingMinor).not.toBe(0n);
        expect(inv.state).not.toBe('paid');
      }
    }
  });
});

describe('USD path (never mixed)', () => {
  it('keeps nurline in USD with outstanding 100_000n', () => {
    const nurline = buildCustomerDetail('nurline');
    expect(nurline.currency).toBe('USD');
    expect(nurline.outstandingMinor).toBe(100_000n);
    expect(nurline.invoices).toHaveLength(1);
    expect(nurline.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-200',
      currency: 'USD',
      overdueDays: 17,
      state: 'overdue',
    });
    expect(nurline.invoices[0]?.originalMinor).toBe(120_000n);
    expect(nurline.invoices[0]?.remainingMinor).toBe(100_000n);
  });
});

describe('timeline tiebreaks (fixture limits)', () => {
  // NOTE — same-day different-kind KIND_RANK path is untestable via fixtures:
  // mega 09-04 has a promise only; all mega timeline days are distinct, so the
  // customers.ts KIND_RANK comparator (call 0 < note 1 < promise 2 < overdue 3
  // < invoice 4) never fires on equal days. This pins that precondition
  // instead of asserting the tie indirectly.
  it('documents KIND_RANK tie untestable: mega days are all distinct', () => {
    const mega = buildCustomerDetail('mega');
    const days = mega.timeline.map((e) => e.day);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain('2026-09-04');
    expect(mega.timeline.filter((e) => e.day === '2026-09-04')).toHaveLength(1);
  });

  // NOTE — title tiebreak (same day + same kind → title localeCompare,
  // customers.ts:198-200) is untestable via fixtures: no customer timeline
  // has two events sharing both day and kind (mega 09-04 is a single
  // promise). Asserted exhaustively across all listable debtors.
  it('documents title tiebreak untestable: no same-day same-kind pair exists', () => {
    const rows = buildCustomerList();
    for (const row of rows) {
      const d = buildCustomerDetail(row.customerId);
      const keys = d.timeline.map((e) => `${e.day}|${e.kind}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
