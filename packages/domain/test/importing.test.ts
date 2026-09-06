import { describe, expect, it } from 'vitest';
import {
  FALLBACK_NET_DAYS,
  applyDuplicateBlocks,
  importKeyFor,
  parseAmountMinor,
  summarizeImport,
  validateImportRow,
  type ImportRowInput,
} from '../src/importing.js';

const row = (over: Partial<ImportRowInput> = {}): ImportRowInput => ({
  rowNumber: 1,
  customerName: 'Mega Shop',
  tin: '304819201',
  externalCustomerId: null,
  invoiceNumber: 'INV-115',
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-22',
  remainingRaw: '15 000 000',
  currency: 'UZS',
  ...over,
});

describe('parseAmountMinor', () => {
  it.each([
    ['12 500 000', 1_250_000_000n],
    ['12,500,000', 1_250_000_000n],
    ['12.500.000 UZS', 1_250_000_000n],
    ['15 000 000.50', 1_500_000_050n],
    ['1,234.56', 123_456n],
    ['1.234,56', 123_456n],
    ['100 USD', 10_000n],
    ['92233720368547758.07', 9_223_372_036_854_775_807n], // PG bigint ceiling, exactly
    ['0', 0n],
    ['0.50', 50n],
  ])('%s → %s minor', (raw, minor) => {
    expect(parseAmountMinor(raw)).toBe(minor);
  });

  it.each([
    ['-5'],
    ['−100'], // U+2212 unicode minus
    ['abc'],
    [''],
    ['1.2.3'],
    ['12..500'],
    ['1,23,456'],
    ['.5'],
    ['10 UZS extra'],
    ['1,234'], // single separator + 3-digit tail: thousands or decimal? refuse to guess
    ['1.234'],
    ['99999999999999999999'], // beyond PG bigint
  ])('%s throws', (raw) => {
    expect(() => parseAmountMinor(raw)).toThrow();
  });
});

describe('validateImportRow', () => {
  it('accepts a clean row', () => {
    const v = validateImportRow(row());
    expect(v.verdict).toBe('valid');
    expect(v.issues).toEqual([]);
    expect(v.amountMinor).toBe(1_500_000_000n);
    expect(v.effectiveDueDate).toBe('2026-08-22');
  });

  it('accepts zero remaining as valid (nothing to collect)', () => {
    expect(validateImportRow(row({ remainingRaw: '0' })).verdict).toBe('valid');
  });

  it('blocks missing customer or invoice', () => {
    expect(validateImportRow(row({ customerName: '  ' })).verdict).toBe('blocked');
    expect(validateImportRow(row({ invoiceNumber: null })).verdict).toBe('blocked');
  });

  it('blocks invalid amounts (text, negative)', () => {
    expect(validateImportRow(row({ remainingRaw: 'twelve' })).verdict).toBe('blocked');
    expect(validateImportRow(row({ remainingRaw: '-500' })).verdict).toBe('blocked');
    expect(validateImportRow(row({ remainingRaw: null })).verdict).toBe('blocked');
  });

  it('warns on missing due date with Net-15 fallback', () => {
    // Invoice 2024-02-15 + 15d crosses the leap-day boundary → 2024-03-01.
    const v = validateImportRow(row({ dueDate: null, invoiceDate: '2024-02-15' }));
    expect(v.verdict).toBe('warning');
    expect(v.effectiveDueDate).toBe('2024-03-01');
    expect(v.issues.map((i) => i.code)).toContain('MISSING_DUE_DATE');
  });

  it('falls back across a month boundary', () => {
    expect(validateImportRow(row({ dueDate: '', invoiceDate: '2026-01-20' })).effectiveDueDate).toBe(
      '2026-02-04',
    );
  });

  it('blocks when both dates are missing or malformed', () => {
    expect(validateImportRow(row({ dueDate: null, invoiceDate: null })).verdict).toBe('blocked');
    expect(validateImportRow(row({ dueDate: '22.08.2026' })).verdict).toBe('blocked');
    expect(validateImportRow(row({ dueDate: null, invoiceDate: 'yesterday' })).verdict).toBe(
      'blocked',
    );
  });

  it('warns on short TIN and unmatched customers, never auto-merges by name', () => {
    const short = validateImportRow(row({ tin: '30481' }));
    expect(short.verdict).toBe('warning');
    // Malformed TIN is unusable as a ref: both flags fire.
    expect(short.issues.map((i) => i.code)).toContain('SHORT_TIN');
    expect(short.issues.map((i) => i.code)).toContain('UNMATCHED_CUSTOMER');
    const unmatched = validateImportRow(row({ tin: null, externalCustomerId: null }));
    expect(unmatched.issues.map((i) => i.code)).toContain('UNMATCHED_CUSTOMER');
    // External id satisfies matching without a TIN.
    expect(
      validateImportRow(row({ tin: null, externalCustomerId: 'EXT-9' })).issues.map((i) => i.code),
    ).not.toContain('UNMATCHED_CUSTOMER');
  });

  it('rejects bad row numbers and currencies', () => {
    expect(() => validateImportRow(row({ rowNumber: 0 }))).toThrow(RangeError);
    expect(() => validateImportRow(row({ currency: 'uzs' }))).toThrow(RangeError);
  });
});

describe('importKeyFor', () => {
  it('is stable across case and whitespace, ref included', () => {
    expect(importKeyFor('o1', 'EXT-9', ' INV-115 ')).toBe(
      importKeyFor('o1', 'ext-9', 'inv-115'),
    );
  });

  it('throws on empty parts so keys never collapse rows', () => {
    expect(() => importKeyFor('', 'a', 'b')).toThrow(RangeError);
    expect(() => importKeyFor('o1', '  ', 'b')).toThrow(RangeError);
    expect(() => importKeyFor('o1', 'a', '')).toThrow(RangeError);
  });

  it('throws on separator injection', () => {
    expect(() => importKeyFor('o1', 'a|b', 'INV-1')).toThrow(RangeError);
    expect(() => importKeyFor('o|1', 'a', 'INV-1')).toThrow(RangeError);
  });
});

describe('applyDuplicateBlocks + summarizeImport', () => {
  it('blocks repeats within one file and counts the screen split', () => {
    const rows = [
      validateImportRow(row({ rowNumber: 1 })),
      validateImportRow(row({ rowNumber: 2, dueDate: null })), // warning
      validateImportRow(row({ rowNumber: 3, remainingRaw: 'bad' })), // blocked
    ];
    const keys = [
      importKeyFor('o1', '304819201', 'INV-115'),
      importKeyFor('o1', 'X', 'INV-200'),
      importKeyFor('o1', '304819201', 'INV-115'), // dupe of row 1
    ];
    const out = applyDuplicateBlocks(rows, keys);
    // Both rows sharing the key block: the file can't say which is the original.
    expect(out[0]?.verdict).toBe('blocked');
    expect(out[0]?.issues.map((i) => i.code)).toContain('DUPLICATE_IN_FILE');
    expect(out[1]?.verdict).toBe('warning');
    expect(out[2]?.verdict).toBe('blocked');
    expect(out[2]?.issues.map((i) => i.code)).toContain('DUPLICATE_IN_FILE');
    expect(summarizeImport(out)).toEqual({ valid: 0, warnings: 1, blocked: 2 });
  });

  it('returns rows untouched when keys are unique', () => {
    const rows = [validateImportRow(row({ rowNumber: 1 }))];
    expect(applyDuplicateBlocks(rows, ['o1|a|INV-1'])).toEqual(rows);
  });

  it('throws on misaligned or blank-key input', () => {
    expect(() => applyDuplicateBlocks([], ['x'])).toThrow(RangeError);
    expect(() => applyDuplicateBlocks([validateImportRow(row())], [''])).toThrow(RangeError);
  });
});

describe('FALLBACK_NET_DAYS', () => {
  it('documents the screen-confirmed default', () => {
    expect(FALLBACK_NET_DAYS).toBe(15);
  });
});

describe('importing adversarial (missing-edge cover)', () => {
  it('parses NBSP thousand separators', () => {
    // U+00A0 NBSP collapses via the \s+ step, same as ASCII spaces.
    expect(parseAmountMinor('12\u00A0500\u00A0000')).toBe(1_250_000_000n);
    expect(parseAmountMinor('12\u202F500\u202F000')).toBe(1_250_000_000n);
  });

  it('strips Cyrillic SOM suffixes (СУМ / СЎМ with breve)', () => {
    expect(parseAmountMinor('12 500 000 СУМ')).toBe(1_250_000_000n);
    expect(parseAmountMinor('12 500 000 СЎМ')).toBe(1_250_000_000n);
  });

  it('parses zero with decimals as zero minor', () => {
    expect(parseAmountMinor('0.00')).toBe(0n);
  });

  it('applies Net-15 fallback when invoiceDate has trailing spaces', () => {
    const v = validateImportRow(row({ dueDate: null, invoiceDate: '2026-01-20   ' }));
    expect(v.verdict).toBe('warning');
    expect(v.effectiveDueDate).toBe('2026-02-04');
    expect(v.issues.map((i) => i.code)).toContain('MISSING_DUE_DATE');
  });

  it('accepts TIN with inner spaces as usable (no SHORT_TIN / UNMATCHED)', () => {
    const v = validateImportRow(row({ tin: '304 819 201' }));
    expect(v.verdict).toBe('valid');
    expect(v.issues.map((i) => i.code)).not.toContain('SHORT_TIN');
    expect(v.issues.map((i) => i.code)).not.toContain('UNMATCHED_CUSTOMER');
  });

  it('accepts dueDate with trailing space (trimmed, valid)', () => {
    const v = validateImportRow(row({ dueDate: '2026-08-22   ' }));
    expect(v.verdict).toBe('valid');
    expect(v.effectiveDueDate).toBe('2026-08-22');
  });

  it('throws batch-abort on non-integer rowNumbers', () => {
    expect(() => validateImportRow(row({ rowNumber: 2.5 }))).toThrow(RangeError);
    expect(() => validateImportRow(row({ rowNumber: NaN }))).toThrow(RangeError);
  });

  it('throws batch-abort on inner-space currency', () => {
    expect(() => validateImportRow(row({ currency: 'US D' }))).toThrow(RangeError);
  });

  it('blocks all three rows sharing one key', () => {
    const rows = [
      validateImportRow(row({ rowNumber: 1 })),
      validateImportRow(row({ rowNumber: 2 })),
      validateImportRow(row({ rowNumber: 3 })),
    ];
    const key = importKeyFor('o1', '304819201', 'INV-115');
    const out = applyDuplicateBlocks(rows, [key, key, key]);
    expect(out.map((r) => r.verdict)).toEqual(['blocked', 'blocked', 'blocked']);
    for (const r of out) {
      expect(r.issues.map((i) => i.code)).toContain('DUPLICATE_IN_FILE');
    }
    expect(summarizeImport(out)).toEqual({ valid: 0, warnings: 0, blocked: 3 });
  });

  it('summarizes an empty list as all zeros', () => {
    expect(summarizeImport([])).toEqual({ valid: 0, warnings: 0, blocked: 0 });
  });
});
