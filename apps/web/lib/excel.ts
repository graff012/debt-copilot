import type { ImportRowInput } from '@debt-copilot/domain';

// ---------------------------------------------------------------------------
// Deterministic Excel helpers. Rule-based header mapping and cell coercion —
// no AI here (AI mapping is a packages/ai task). All parsing is local.
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ROWS = 5000;

export type SheetField =
  | 'customerName'
  | 'tin'
  | 'externalCustomerId'
  | 'invoiceNumber'
  | 'invoiceDate'
  | 'dueDate'
  | 'remainingRaw'
  | 'collector';

const ALIASES: Record<SheetField, readonly string[]> = {
  // Deliberately tight: bare 'номер'/'дата'/'срок'/'код' matched phone numbers,
  // payment dates, expiry dates, product codes in review. A missed column
  // surfaces as blocked/warning downstream; a wrong column corrupts silently.
  customerName: ['контрагент', 'customer', 'mijoz', 'клиент', 'покупатель'],
  tin: ['инн', 'пинфл', 'tin', 'inn', 'стир'],
  externalCustomerId: ['external id', 'внешний id', 'код контрагента'],
  invoiceNumber: ['номер документа', 'invoice', 'faktura', 'счет', 'счёт'],
  invoiceDate: ['дата отгрузки', 'invoice date', 'дата документа'],
  dueDate: ['срок оплаты', 'due date', 'оплатить до'],
  remainingRaw: ['остаток долга', 'remaining', 'balance', 'карз', 'сумма долга'],
  collector: ['ответственный менеджер', 'collector'],
};

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Map header row cells to system fields. First alias hit wins, null = unmapped. */
export function mapHeaders(headers: readonly unknown[]): readonly (SheetField | null)[] {
  return headers.map((h) => {
    if (typeof h !== 'string') return null;
    const n = normalize(h);
    if (!n) return null;
    for (const [field, aliases] of Object.entries(ALIASES) as Array<[SheetField, readonly string[]]>) {
      if (aliases.some((a) => n === a || n.startsWith(`${a} `) || n.startsWith(`${a}(`))) return field;
    }
    return null;
  });
}

/** Latest plausible serial: end of 2099. Debt files never date past it; a money
 *  cell mis-mapped as a date would otherwise land centuries out, sometimes
 *  still passing day validation. */
const MAX_SERIAL = 73050;

/** Excel serial (1900 system) → YYYY-MM-DD via UTC noon (no tz drift). */
export function excelSerialToDay(serial: number): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > MAX_SERIAL) {
    throw new RangeError('Invalid excel date serial');
  }
  const ms = Math.round((serial - 25569) * 86_400_000) + 43_200_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_RE = /^(\d{1,2})[.](\d{1,2})[.](\d{4})$/;

/** Coerce an unknown cell to day text. Numbers in day columns are Excel serials. */
export function toDayText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return excelSerialToDay(cell);
  if (typeof cell !== 'string') return null;
  const s = cell.trim();
  if (!s) return null;
  if (ISO_RE.test(s)) return s;
  const dmy = DMY_RE.exec(s);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  }
  return s; // Pass through: domain day validation judges it (blocked if garbage).
}

/** Coerce an unknown cell to text. Integers stay exact (no float formatting). */
export function toCellText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return null;
    // Doubles round-trip short decimals exactly; big integers stay exact < 2^53.
    // Numeric TINs lose leading zeros here — unrecoverable at source, and the
    // SHORT_TIN warning downstream is the safety net (never pad-guess).
    return String(cell);
  }
  // Booleans degrade to null, which always surfaces as blocked/warning
  // downstream (missing-field errors) — fail-loud, never silently accepted.
  if (typeof cell !== 'string') return null;
  const s = cell.trim();
  return s ? s : null;
}

/** Trailing currency code in a money cell overrides the file default, so a
 *  "$100" cell in a UZS file is labeled USD instead of silently mislabeled. */
const CELL_CURRENCY_RE = /\s*([A-Z]{3}|СУМ|СЎМ)$/i;

export function splitCellCurrency(raw: string): { text: string; currency: string | null } {
  const m = CELL_CURRENCY_RE.exec(raw.trim());
  if (!m?.[1]) return { text: raw, currency: null };
  const upper = m[1].toUpperCase();
  const code = upper === 'СУМ' || upper === 'СЎМ' ? 'UZS' : upper;
  return { text: raw.trim().slice(0, -m[0].length).trim(), currency: code };
}

const isEmptyRow = (row: readonly unknown[]): boolean =>
  row.every((c) => c === null || c === undefined || (typeof c === 'string' && !c.trim()));

/**
 * Sheet rows (first row = headers) → validator inputs. Skips blank rows,
 * caps at MAX_ROWS (throws beyond — explicit, never silently truncated).
 */
export function sheetToInputs(
  sheet: readonly (readonly unknown[])[],
  currency: string,
): ImportRowInput[] {
  if (sheet.length === 0) throw new RangeError('Sheet is empty');
  const header = sheet[0];
  if (!header) throw new RangeError('Sheet is empty');
  const mapping = mapHeaders(header);
  const inputs: ImportRowInput[] = [];
  let rowNumber = 1;
  for (const raw of sheet.slice(1)) {
    rowNumber += 1; // Physical Excel row: blank rows still count, so errors point correctly.
    if (isEmptyRow(raw)) continue;
    if (inputs.length >= MAX_ROWS) {
      throw new RangeError(`Too many rows (limit ${MAX_ROWS}) — split the file`);
    }
    const get = (field: SheetField): unknown => {
      const idx = mapping.indexOf(field);
      return idx === -1 ? null : (raw[idx] ?? null);
    };
    const dueCell = get('dueDate');
    const invCell = get('invoiceDate');
    const moneyCell = toCellText(get('remainingRaw'));
    const split = moneyCell === null ? null : splitCellCurrency(moneyCell);
    inputs.push({
      rowNumber,
      customerName: toCellText(get('customerName')),
      tin: toCellText(get('tin')),
      externalCustomerId: toCellText(get('externalCustomerId')),
      invoiceNumber: toCellText(get('invoiceNumber')),
      invoiceDate: toDayText(invCell),
      dueDate: toDayText(dueCell),
      remainingRaw: split?.text ?? null,
      currency: split?.currency ?? currency,
    });
  }
  return inputs;
}

/** Guess file currency from the remaining-balance header, default UZS. */
export function detectCurrency(headers: readonly unknown[]): string {
  for (const h of headers) {
    if (typeof h !== 'string') continue;
    const n = normalize(h);
    if (n.includes('$') || n.includes('usd')) return 'USD';
  }
  return 'UZS';
}
