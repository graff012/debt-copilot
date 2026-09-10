import { describe, expect, it } from 'vitest';
import { formatMinor } from '../src/format';

describe('formatMinor', () => {
  it('groups majors with commas', () => {
    expect(formatMinor(1_500_000_00n, 'UZS')).toBe('1,500,000 UZS');
    expect(formatMinor(4_660_000_000n, 'UZS')).toBe('46,600,000 UZS');
    expect(formatMinor(100_000n, 'USD')).toBe('1,000 USD');
  });

  it('keeps exact cents and signs', () => {
    expect(formatMinor(50n, 'UZS')).toBe('0.50 UZS');
    expect(formatMinor(0n, 'UZS')).toBe('0 UZS');
    expect(formatMinor(-150n, 'UZS')).toBe('-1.50 UZS');
  });
});
