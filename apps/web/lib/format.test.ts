import { describe, expect, it } from 'vitest';
import { formatMillions, formatMoney } from './format';

// Adversarial cover for BigInt-safe formatting. All asserts are string
// equality over bigint minor units — never float.
describe('formatMoney adversarial', () => {
  it('renders zero without decimals', () => {
    expect(formatMoney(0n, 'UZS')).toBe('0 UZS');
    expect(formatMoney(0n, 'USD')).toBe('0 USD');
  });

  it('renders sub-100n cents as 0.xx (no grouping, padded frac)', () => {
    expect(formatMoney(50n, 'UZS')).toBe('0.50 UZS');
    expect(formatMoney(5n, 'UZS')).toBe('0.05 UZS');
    expect(formatMoney(1n, 'USD')).toBe('0.01 USD');
  });

  it('renders negatives with leading sign on the whole', () => {
    expect(formatMoney(-150n, 'UZS')).toBe('-1.50 UZS');
    expect(formatMoney(-5n, 'UZS')).toBe('-0.05 UZS');
    expect(formatMoney(-6_010_000_000n, 'UZS')).toBe('-60,100,000 UZS');
  });

  it('groups large tiyin totals with en-US commas', () => {
    // Dashboard fixture total: 6_010_000_000n minor = 60_100_000 major.
    expect(formatMoney(6_010_000_000n, 'UZS')).toBe('60,100,000 UZS');
    expect(formatMoney(1_350_000_000n, 'UZS')).toBe('13,500,000 UZS');
    expect(formatMoney(100_000n, 'USD')).toBe('1,000 USD');
  });
});

describe('formatMillions adversarial', () => {
  it('renders zero, sub-million, negative, and large as X.YM', () => {
    expect(formatMillions(0n, 'UZS')).toBe('0.0M UZS');
    expect(formatMillions(50n, 'UZS')).toBe('0.0M UZS'); // sub-million → 0.0M
    expect(formatMillions(-300_000_000n, 'UZS')).toBe('-3.0M UZS');
    expect(formatMillions(6_010_000_000n, 'UZS')).toBe('60.1M UZS');
  });
});
