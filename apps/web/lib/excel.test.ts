import { describe, expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import { previewRows } from './import-preview';
import {
  detectCurrency,
  excelSerialToDay,
  mapHeaders,
  MAX_ROWS,
  sheetToInputs,
  splitCellCurrency,
  toCellText,
  toDayText,
} from './excel';

describe('mapHeaders', () => {
  it('matches Russian, Uzbek, and English header variants', () => {
    expect(
      mapHeaders(['Контрагент', 'ИНН', 'Номер документа', 'Дата отгрузки', 'Срок оплаты', 'Остаток долга (сум)', 'Ответственный менеджер']),
    ).toEqual([
      'customerName',
      'tin',
      'invoiceNumber',
      'invoiceDate',
      'dueDate',
      'remainingRaw',
      'collector',
    ]);
  });

  it('tolerates case, extra spaces, and suffixes', () => {
    expect(mapHeaders(['  КОНТРАГЕНТ ', 'Mijoz', 'Faktura', 'Balance ($)', 'TIN'])).toEqual([
      'customerName',
      'customerName',
      'invoiceNumber',
      'remainingRaw',
      'tin',
    ]);
  });

  it('refuses loose aliases that caused silent misimports', () => {
    // Bare номер/дата/срок/код matched phones, payment dates, expiries, product codes.
    expect(
      mapHeaders(['Номер телефона', 'Дата оплаты', 'Код товара', 'Срок годности', 'Менеджер']),
    ).toEqual([null, null, null, null, null]);
  });

  it('leaves unknown and non-text headers unmapped', () => {
    expect(mapHeaders(['Foo', '', 42, null])).toEqual([null, null, null, null]);
  });
});

describe('excelSerialToDay', () => {
  it('converts serials without tz drift', () => {
    expect(excelSerialToDay(45812)).toBe('2025-06-04');
    expect(excelSerialToDay(44927)).toBe('2023-01-01');
  });

  it('rejects garbage', () => {
    expect(() => excelSerialToDay(NaN)).toThrow(RangeError);
    expect(() => excelSerialToDay(-1)).toThrow(RangeError);
    // Debt files never date past 2100; a money cell mis-mapped as a date must not pass.
    expect(() => excelSerialToDay(73_051)).toThrow(RangeError);
    expect(excelSerialToDay(73_050)).toBe('2099-12-31');
  });
});

describe('toDayText', () => {
  it('passes ISO through and converts DMY', () => {
    expect(toDayText('2026-08-22')).toBe('2026-08-22');
    expect(toDayText('01.08.2026')).toBe('2026-08-01');
    expect(toDayText('1.8.2026')).toBe('2026-08-01');
  });

  it('treats numbers as serials, nulls as null', () => {
    expect(toDayText(45812)).toBe('2025-06-04');
    expect(toDayText(null)).toBeNull();
    expect(toDayText('')).toBeNull();
  });

  it('passes garbage through for domain rejection (never guesses)', () => {
    expect(toDayText('yesterday')).toBe('yesterday');
  });
});

describe('toCellText', () => {
  it('keeps integers exact and stringifies safely', () => {
    expect(toCellText(15_000_000)).toBe('15000000');
    expect(toCellText(' Mega ')).toBe('Mega');
    expect(toCellText(null)).toBeNull();
    expect(toCellText(true)).toBeNull();
    expect(toCellText(NaN)).toBeNull();
  });
});

describe('sheetToInputs', () => {
  const sheet = [
    ['Контрагент', 'ИНН', 'Номер документа', 'Дата отгрузки', 'Срок оплаты', 'Остаток долга (сум)'],
    ['Mega Shop', '304819201', 'INV-115', '01.08.2026', '21.08.2026', 15_000_000],
    [],
    ['Bad Row', '123', 'INV-1', 45812, 45833, 'ten'],
  ];

  it('maps rows, skips blanks, coerces cells', () => {
    const inputs = sheetToInputs(sheet, 'UZS');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      rowNumber: 2,
      customerName: 'Mega Shop',
      tin: '304819201',
      invoiceNumber: 'INV-115',
      invoiceDate: '2026-08-01',
      dueDate: '2026-08-21',
      remainingRaw: '15000000',
      currency: 'UZS',
    });
    expect(inputs[1]).toMatchObject({ rowNumber: 4, invoiceDate: '2025-06-04' });
  });

  it('throws on empty sheets and row floods (never silently truncates)', () => {
    expect(() => sheetToInputs([], 'UZS')).toThrow(RangeError);
    const big: unknown[][] = [['A'], ...Array.from({ length: 5001 }, () => ['x'])];
    expect(() => sheetToInputs(big, 'UZS')).toThrow(RangeError);
  });
});

describe('detectCurrency', () => {
  it('spots USD markers, defaults UZS', () => {
    expect(detectCurrency(['Balance ($)'])).toBe('USD');
    expect(detectCurrency(['Остаток долга (сум)'])).toBe('UZS');
    expect(detectCurrency([])).toBe('UZS');
  });
});

describe('splitCellCurrency', () => {
  it('overrides the file default per cell', () => {
    expect(splitCellCurrency('100 USD')).toEqual({ text: '100', currency: 'USD' });
    expect(splitCellCurrency('12 500 000 сум')).toEqual({ text: '12 500 000', currency: 'UZS' });
    expect(splitCellCurrency('5000')).toEqual({ text: '5000', currency: null });
  });
});

describe('per-cell currency in sheets', () => {
  it('labels a USD cell inside a UZS file instead of mislabeling it', () => {
    const inputs = sheetToInputs(
      [
        ['Контрагент', 'ИНН', 'Номер документа', 'Дата отгрузки', 'Срок оплаты', 'Остаток долга (сум)'],
        ['Nurline Market', '305552223', 'INV-200', '30.07.2026', '20.08.2026', '100 USD'],
      ],
      'UZS',
    );
    expect(inputs[0]).toMatchObject({ currency: 'USD', remainingRaw: '100' });
  });
});

describe('xlsx round-trip', () => {
  it('parses a real .xlsx buffer into a valid preview', () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([
      ['Контрагент', 'ИНН', 'Номер документа', 'Дата отгрузки', 'Срок оплаты', 'Остаток долга (сум)'],
      ['Mega Shop', '304819201', 'INV-115', '01.08.2026', '21.08.2026', 15_000_000],
      ['Bad Row', '123', 'INV-1', 'yesterday', 'tomorrow', 'ten'],
    ]);
    utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = write(workbook, { type: 'array', bookType: 'xlsx' });
    const back = read(buffer, { type: 'array' });
    const name = back.SheetNames[0];
    if (!name) throw new Error('no sheet');
    const ws = back.Sheets[name];
    if (!ws) throw new Error('empty sheet');
    const grid = utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    const inputs = sheetToInputs(grid, detectCurrency(grid[0] ?? []));
    expect(inputs).toHaveLength(2);
    const preview = previewRows(inputs);
    expect(preview.summary).toEqual({ valid: 1, warnings: 0, blocked: 1 });
    expect(preview.rows[0]?.amountMinor).toBe(1_500_000_000n);
  });
});

describe('toCellText booleans fail-loud', () => {
  it('degrades booleans to null so missing-field errors surface downstream', () => {
    // Documented in excel.ts: booleans never silently accepted.
    expect(toCellText(true)).toBeNull();
    expect(toCellText(false)).toBeNull();
  });
});

describe('toDayText numeric strings', () => {
  it('passes numeric strings through for domain rejection (never a serial)', () => {
    // Only typeof number is a serial; '45812' stays text so domain day validation blocks it.
    expect(toDayText('45812')).toBe('45812');
  });
});

describe('sheetToInputs unmapped columns', () => {
  it('keeps positions when an unknown header sits between known ones', () => {
    const inputs = sheetToInputs(
      [
        ['Контрагент', 'Случайная колонка', 'Номер документа'],
        ['Mega Shop', 'JUNK', 'INV-115'],
      ],
      'UZS',
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      rowNumber: 2,
      customerName: 'Mega Shop',
      invoiceNumber: 'INV-115',
      tin: null,
      remainingRaw: null,
    });
  });
});

describe('sheetToInputs MAX_ROWS boundary', () => {
  it('accepts exactly MAX_ROWS data rows, rejects MAX_ROWS + 1', () => {
    const header = ['Контрагент'];
    const atLimit: unknown[][] = [header, ...Array.from({ length: MAX_ROWS }, (_, i) => [`Shop ${i}`])];
    expect(sheetToInputs(atLimit, 'UZS')).toHaveLength(MAX_ROWS);
    const overLimit: unknown[][] = [header, ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`Shop ${i}`])];
    expect(() => sheetToInputs(overLimit, 'UZS')).toThrow(RangeError);
  });
});

describe('detectCurrency bare word', () => {
  it("treats a bare 'USD' header as USD", () => {
    expect(detectCurrency(['USD'])).toBe('USD');
  });
});

describe('sheetToInputs empty states (UploadZone branches)', () => {
  it('throws on [] and returns [] on headers-only so the component error branch is reachable', () => {
    // UploadZone rendering itself is untested (no jsdom here); this pins the
    // pure-function contract its explicit error branch depends on:
    // empty grid throws, headers-only yields zero inputs → 'No data rows found'.
    expect(() => sheetToInputs([], 'UZS')).toThrow(RangeError);
    expect(sheetToInputs([['Контрагент', 'ИНН']], 'UZS')).toEqual([]);
  });
});
