import { describe, expect, it } from 'vitest';
import { MAPPING_ROWS, buildImportPreview } from './import-preview';

// Hand-counted from the BATCH fixture: 3 valid / 3 warnings / 3 blocked.
// Valid: clean Mega, zero-amount Silk, USD Nurline.
// Warnings: missing-due Grand Food, short-TIN Navoiy, ref-less walk-in.
// Blocked: bad-amount Zarafshan, duplicate INV-116 pair.
describe('buildImportPreview', () => {
  const preview = buildImportPreview();

  it('splits the batch through real validators', () => {
    expect(preview.summary).toEqual({ valid: 3, warnings: 3, blocked: 3 });
    expect(preview.rows).toHaveLength(9);
  });

  it('derives each verdict from domain rules', () => {
    const byRow = Object.fromEntries(preview.rows.map((r) => [r.rowNumber, r]));
    expect(byRow[2]?.verdict).toBe('valid');
    expect(byRow[2]?.amountMinor).toBe(1_500_000_000n);
    expect(byRow[3]?.verdict).toBe('warning');
    expect(byRow[3]?.effectiveDueDate).toBe('2026-08-25'); // Net-15 from Aug 10
    expect(byRow[4]?.verdict).toBe('blocked');
    expect(byRow[5]?.issues.map((i) => i.code)).toContain('SHORT_TIN');
    expect(byRow[6]?.verdict).toBe('blocked');
    expect(byRow[7]?.verdict).toBe('blocked');
    expect(byRow[8]?.verdict).toBe('valid');
    expect(byRow[9]?.amountMinor).toBe(10_000n);
  });

  it('leaves ref-less rows unkeyed instead of inventing colliding keys', () => {
    const walkIn = preview.rows.find((r) => r.rowNumber === 10);
    expect(walkIn?.verdict).toBe('warning');
    expect(walkIn?.issues.map((i) => i.code)).toContain('UNMATCHED_CUSTOMER');
    expect(walkIn?.issues.map((i) => i.code)).not.toContain('DUPLICATE_IN_FILE');
  });

  it('pins the confirmed 7-column mapping', () => {
    expect(MAPPING_ROWS).toHaveLength(7);
    expect(MAPPING_ROWS[0]).toMatchObject({ source: 'Контрагент', system: 'Customer name' });
  });

  it('keeps every rowNumber 2..10 in order after the keyed/unkeyed merge', () => {
    expect(preview.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps summary in sync with a recount from rows by verdict', () => {
    const recount = {
      valid: preview.rows.filter((r) => r.verdict === 'valid').length,
      warnings: preview.rows.filter((r) => r.verdict === 'warning').length,
      blocked: preview.rows.filter((r) => r.verdict === 'blocked').length,
    };
    expect(preview.summary).toEqual(recount);
  });

  it('keeps mapping previews as raw source text', () => {
    expect(MAPPING_ROWS[3]).toMatchObject({ source: 'Дата отгрузки', preview: '01.08.2026' });
    expect(MAPPING_ROWS[5]).toMatchObject({
      source: 'Остаток долга (сум)',
      preview: '15 000 000',
    });
  });

  it('keeps zero-amount effectiveDueDate on its own dueDate', () => {
    const zero = preview.rows.find((r) => r.rowNumber === 8);
    expect(zero?.amountMinor).toBe(0n);
    expect(zero?.effectiveDueDate).toBe('2026-09-06');
  });

  it('parses the missing-due row amount to bigint minor units', () => {
    const missingDue = preview.rows.find((r) => r.rowNumber === 3);
    expect(missingDue?.amountMinor).toBe(600_000_000n);
  });
});
