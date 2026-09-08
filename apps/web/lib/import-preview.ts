import {
  applyDuplicateBlocks,
  importKeyFor,
  summarizeImport,
  validateImportRow,
  type ImportRowInput,
  type ImportSummary,
  type ValidatedRow,
} from '@debt-copilot/domain';
import { ORG_ID } from './fixtures';

// ---------------------------------------------------------------------------
// Import preview: a fixed demo batch through the real domain validators.
// Counts on the page must equal summarizeImport here — never typed numbers.
// ---------------------------------------------------------------------------

export interface MappingRow {
  readonly source: string;
  readonly system: string;
  readonly preview: string;
}

export const MAPPING_ROWS: readonly MappingRow[] = [
  { source: 'Контрагент', system: 'Customer name', preview: 'Mega Shop' },
  { source: 'ИНН / ПИНФЛ', system: 'Tax ID (TIN)', preview: '304819201' },
  { source: 'Номер документа', system: 'Invoice number', preview: 'INV-115' },
  { source: 'Дата отгрузки', system: 'Invoice date', preview: '01.08.2026' },
  { source: 'Срок оплаты', system: 'Due date', preview: '21.08.2026' },
  { source: 'Остаток долга (сум)', system: 'Remaining balance', preview: '15 000 000' },
  { source: 'Ответственный менеджер', system: 'Collector', preview: 'Aziz R.' },
];

const BATCH: readonly ImportRowInput[] = [
  {
    rowNumber: 2,
    customerName: 'Mega Shop',
    tin: '304819201',
    externalCustomerId: null,
    invoiceNumber: 'INV-115',
    invoiceDate: '2026-08-01',
    dueDate: '2026-08-22',
    remainingRaw: '15 000 000',
    currency: 'UZS',
  },
  {
    rowNumber: 3,
    customerName: 'Grand Food Distribution',
    tin: '201884455',
    externalCustomerId: null,
    invoiceNumber: 'INV-189',
    invoiceDate: '2026-08-10',
    dueDate: null,
    remainingRaw: '6 000 000',
    currency: 'UZS',
  },
  {
    rowNumber: 4,
    customerName: 'Zarafshan Savdo LLC',
    tin: '309991112',
    externalCustomerId: null,
    invoiceNumber: 'INV-142',
    invoiceDate: '2026-08-02',
    dueDate: '2026-08-23',
    remainingRaw: 'twelve million',
    currency: 'UZS',
  },
  {
    rowNumber: 5,
    customerName: 'Navoiy Optom Savdo',
    tin: '30481',
    externalCustomerId: null,
    invoiceNumber: 'INV-245',
    invoiceDate: '2026-08-05',
    dueDate: '2026-08-26',
    remainingRaw: '2 500 000',
    currency: 'UZS',
  },
  {
    rowNumber: 6,
    customerName: 'Mega Shop',
    tin: '304819201',
    externalCustomerId: null,
    invoiceNumber: 'INV-116',
    invoiceDate: '2026-08-03',
    dueDate: '2026-08-24',
    remainingRaw: '4 000 000',
    currency: 'UZS',
  },
  {
    rowNumber: 7,
    customerName: 'Mega Shop',
    tin: '304819201',
    externalCustomerId: null,
    invoiceNumber: 'INV-116',
    invoiceDate: '2026-08-03',
    dueDate: '2026-08-24',
    remainingRaw: '4 000 000',
    currency: 'UZS',
  },
  {
    rowNumber: 8,
    customerName: 'Silk Road Mart',
    tin: '305552223',
    externalCustomerId: null,
    invoiceNumber: 'INV-141',
    invoiceDate: '2026-08-20',
    dueDate: '2026-09-06',
    remainingRaw: '0',
    currency: 'UZS',
  },
  {
    rowNumber: 9,
    customerName: 'Nurline Market',
    tin: null,
    externalCustomerId: 'EXT-NUR-1',
    invoiceNumber: 'INV-200',
    invoiceDate: '2026-07-30',
    dueDate: '2026-08-20',
    remainingRaw: '100 USD',
    currency: 'USD',
  },
  {
    rowNumber: 10,
    customerName: 'Walk-in Buyer',
    tin: null,
    externalCustomerId: null,
    invoiceNumber: 'INV-301',
    invoiceDate: '2026-08-12',
    dueDate: '2026-08-27',
    remainingRaw: '1 000',
    currency: 'UZS',
  },
];

export interface ImportPreview {
  readonly rows: readonly ValidatedRow[];
  readonly summary: ImportSummary;
}

export function buildImportPreview(): ImportPreview {
  // Rows without a stable ref+invoice are unkeyable: they skip duplicate
  // detection instead of receiving fake keys (fake keys either collide or
  // bypass the domain's empty-throw guard). They still carry their own verdicts.
  const validated: ValidatedRow[] = [];
  const keyedRows: ValidatedRow[] = [];
  const keyedKeys: string[] = [];
  const keyedPos: number[] = [];
  BATCH.forEach((b, i) => {
    const row = validateImportRow({ ...b });
    validated.push(row);
    const ref = (b.tin ?? '').trim() || (b.externalCustomerId ?? '').trim();
    const inv = (b.invoiceNumber ?? '').trim();
    if (ref && inv) {
      keyedRows.push(row);
      keyedKeys.push(importKeyFor(ORG_ID, ref, inv));
      keyedPos.push(i);
    }
  });
  const checked = applyDuplicateBlocks(keyedRows, keyedKeys);
  const byPos = new Map<number, ValidatedRow>();
  checked.forEach((row, k) => {
    const pos = keyedPos[k];
    if (pos !== undefined) byPos.set(pos, row);
  });
  const rows = validated.map((row, i) => byPos.get(i) ?? row);
  return { rows, summary: summarizeImport(rows) };
}
