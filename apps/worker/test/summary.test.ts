import { describe, expect, it } from 'vitest';
import { composeBriefing } from '../src/jobs/summary.js';

const briefing = {
  userId: 'u1',
  telegramUserId: 1n,
  today: '2026-09-06',
  totals: [{ minor: 4_660_000_000n, currency: 'UZS' }],
  promisesDueToday: 2,
  brokenCount: 1,
  topDebtors: [
    {
      customerId: '11111111-1111-4111-8111-111111111111',
      name: 'Mega Shop',
      minor: 1_500_000_000n,
      currency: 'UZS',
      overdueDays: 12,
    },
    {
      customerId: '22222222-2222-4222-8222-222222222222',
      name: 'Blue Market',
      minor: 1_100_000_000n,
      currency: 'UZS',
      overdueDays: 158,
    },
  ],
};

describe('composeBriefing', () => {
  it('renders per-currency totals and top debtors deterministically', () => {
    const { text, buttons } = composeBriefing(briefing);
    expect(text).toContain('2026-09-06');
    expect(text).toContain('4660000000 UZS');
    expect(text).toContain('Promises due today: 2');
    expect(text).toContain('Mega Shop');
    expect(buttons).toHaveLength(4); // Called + Promise per debtor
    expect(buttons[0]?.data).toContain(':called:');
    expect(buttons[1]?.data).toContain(':promise:');
    for (const b of buttons) {
      expect(b.data.length).toBeLessThanOrEqual(64);
    }
  });

  it('groups mixed currencies without summing them', () => {
    const { text } = composeBriefing({
      ...briefing,
      totals: [
        { minor: 100_000_000n, currency: 'UZS' },
        { minor: 50_000n, currency: 'USD' },
      ],
    });
    expect(text).toContain('100000000 UZS');
    expect(text).toContain('50000 USD');
    expect(text).not.toContain('100050000');
  });

  it('handles an empty book without crashing', () => {
    const { text, buttons } = composeBriefing({
      ...briefing,
      totals: [],
      promisesDueToday: 0,
      brokenCount: 0,
      topDebtors: [],
    });
    expect(text).toContain('Nothing overdue');
    expect(text).toContain('Broken promises: 0');
    expect(buttons).toEqual([]);
  });
});
