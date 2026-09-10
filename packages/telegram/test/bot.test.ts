import { describe, expect, it } from 'vitest';
import { decodeCallback, encodeCallback } from '../src/callbacks.js';
import { parseAmountInput, parseDayInput } from '../src/parse.js';

describe('parseDayInput', () => {
  const TODAY = '2026-09-06'; // a Sunday
  it('handles words, ISO, DMY, and weekdays', () => {
    expect(parseDayInput('today', TODAY)).toBe('2026-09-06');
    expect(parseDayInput('завтра', TODAY)).toBe('2026-09-07');
    expect(parseDayInput('2026-09-10', TODAY)).toBe('2026-09-10');
    expect(parseDayInput('10.09.2026', TODAY)).toBe('2026-09-10');
    expect(parseDayInput('friday', TODAY)).toBe('2026-09-11');
    expect(parseDayInput('sunday', TODAY)).toBe('2026-09-13'); // same weekday = next week
  });

  it('returns null on garbage (bot asks again)', () => {
    expect(parseDayInput('soonish', TODAY)).toBeNull();
    expect(parseDayInput('', TODAY)).toBeNull();
  });

  it('wraps saturday from sunday as +6 (same-weekday rule stays +7)', () => {
    // TODAY is Sunday 2026-09-06: saturday is 6 days ahead, not 13.
    expect(parseDayInput('saturday', TODAY)).toBe('2026-09-12');
    // Same weekday is next week, never today (already pinned for sunday).
    expect(parseDayInput('sunday', TODAY)).toBe('2026-09-13');
    expect(parseDayInput('monday', TODAY)).toBe('2026-09-07');
  });
});

describe('parseAmountInput', () => {
  it('accepts full-words and strict amounts', () => {
    expect(parseAmountInput('full', 100n)).toBe(100n);
    expect(parseAmountInput('1 000 000', 999n)).toBe(100_000_000n);
  });

  it('throws on garbage and non-positive', () => {
    expect(() => parseAmountInput('ten', 5n)).toThrow();
    expect(() => parseAmountInput('0', 5n)).toThrow(RangeError);
  });

  it('treats hamma / полностью as full (bigint, no float)', () => {
    expect(parseAmountInput('hamma', 777n)).toBe(777n);
    expect(parseAmountInput('HAMMA', 777n)).toBe(777n);
    expect(parseAmountInput('полностью', 888n)).toBe(888n);
    expect(parseAmountInput('Полностью', 888n)).toBe(888n);
  });
});

describe('callbacks', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('round-trips within the 64-byte limit', () => {
    const data = encodeCallback('promise', id);
    expect(data.length).toBeLessThanOrEqual(64);
    expect(decodeCallback(data)).toEqual({ action: 'promise', customerId: id });
  });

  it('rejects foreign payloads', () => {
    expect(decodeCallback('v1:hack:x')).toBeNull();
    expect(decodeCallback('v1:called:not-a-uuid')).toBeNull();
    expect(decodeCallback('hello')).toBeNull();
  });

  it('refuses non-UUID customer ids at encode time', () => {
    expect(() => encodeCallback('called', 'mega')).toThrow(RangeError);
  });

  it('round-trips customer actions and rejects flow-local namespaces', () => {
    for (const action of ['called', 'promise', 'note'] as const) {
      const data = encodeCallback(action, id);
      expect(data.length).toBeLessThanOrEqual(64);
      expect(decodeCallback(data)).toEqual({ action, customerId: id });
    }
    // confirm:/cancel:/date:/amount: are namespaced flows with dedicated
    // handlers — the generic decoder must NOT claim them (live bug: it once
    // swallowed Confirm and wiped the pending session).
    expect(decodeCallback(`confirm:${id}`)).toBeNull();
    expect(decodeCallback(`cancel:${id}`)).toBeNull();
    expect(decodeCallback('date:today')).toBeNull();
    expect(decodeCallback('amount:full')).toBeNull();
  });
});
