import { addDays, assertDayString } from './time';
import { assertCurrencyCode } from './aging';

/**
 * Deterministic Excel-import row validation (task 2).
 * Operates on already-mapped rows: AI/file parsing happens upstream in
 * packages/ai and apps/api. This module only judges, never reads files.
 */

/** Net terms applied when dueDate is missing but invoiceDate exists (import-screen behavior). */
export const FALLBACK_NET_DAYS = 15;

export interface ImportRowInput {
  readonly rowNumber: number;
  readonly customerName: string | null;
  readonly tin: string | null;
  readonly externalCustomerId: string | null;
  readonly invoiceNumber: string | null;
  readonly invoiceDate: string | null;
  readonly dueDate: string | null;
  /** Raw cell text, e.g. "12 500 000 UZS". Parsed strictly, never guessed. */
  readonly remainingRaw: string | null;
  /** Mapped currency column. Strict ISO shape. */
  readonly currency: string;
}

export type Verdict = 'valid' | 'warning' | 'blocked';

export type IssueCode =
  | 'MISSING_CUSTOMER'
  | 'MISSING_INVOICE'
  | 'INVALID_AMOUNT'
  | 'INVALID_DUE_DATE'
  | 'INVALID_INVOICE_DATE'
  | 'MISSING_DUE_DATE'
  | 'MISSING_BOTH_DATES'
  | 'SHORT_TIN'
  | 'UNMATCHED_CUSTOMER'
  | 'DUPLICATE_IN_FILE';

export interface RowIssue {
  readonly code: IssueCode;
  readonly severity: 'warning' | 'error';
  readonly message: string;
}

export interface ValidatedRow {
  readonly rowNumber: number;
  readonly verdict: Verdict;
  readonly issues: readonly RowIssue[];
  readonly amountMinor: bigint | null;
  /** dueDate when present, else Net-15 fallback from invoiceDate, else null. */
  readonly effectiveDueDate: string | null;
}

const TIN_RE = /^\d{9}$/;
// Any 3-letter code (row currency decides meaning) + som spellings, any case.
// "10 UZS extra" still throws: the code must end the cell.
const SUFFIX_RE = /\s*([A-Z]{3}|СУМ|СЎМ)$/i;
/** Postgres bigint ceiling: validated amounts must fit the column. */
const MAX_MINOR = 9_223_372_036_854_775_807n;

const isBlank = (s: string | null): boolean => s === null || s.trim() === '';

/** Strict thousand-group check: "12.500.000" ok, "1.2.3" throws. */
function stripThousands(intPart: string, raw: string): string {
  if (!/[.,]/.test(intPart)) {
    if (!/^\d+$/.test(intPart)) {
      throw new RangeError(`Invalid amount: ${JSON.stringify(raw)}`);
    }
    return intPart;
  }
  const groups = intPart.split(/[.,]/);
  const first = groups[0];
  const rest = groups.slice(1);
  if (first === undefined || !/^\d{1,3}$/.test(first)) {
    throw new RangeError(`Invalid amount: ${JSON.stringify(raw)}`);
  }
  if (rest.length === 0 || rest.some((g) => !/^\d{3}$/.test(g))) {
    throw new RangeError(`Invalid amount: ${JSON.stringify(raw)}`);
  }
  return groups.join('');
}

/**
 * Parse raw cell text to minor units (×100). Accepts spaces/commas/dots as
 * thousand separators and a trailing currency code, plus an optional
 * 1–2 digit decimal part. Throws on negatives, letters, empties, ambiguity.
 *
 * Ambiguity rule (strict > clever): one separator with exactly 3 trailing
 * digits ("1,234") throws — thousands and decimal readings differ 1000× and
 * money code must not guess. Multiple separators ("12.500.000") are
 * unambiguously thousands.
 */
export function parseAmountMinor(raw: string): bigint {
  if (typeof raw !== 'string') throw new TypeError('amount must be a string');
  // NBSP and other whitespace collapse in the \s+ step below.
  let s = raw.trim();
  if (!s) throw new RangeError('amount is empty');
  if (s.includes('-') || s.includes('−')) {
    throw new RangeError(`Negative amounts are blocked: ${JSON.stringify(raw)}`);
  }
  s = s.replace(SUFFIX_RE, '').trim().replace(/\s+/g, '');
  if (!s) throw new RangeError('amount is empty');

  const seps = (s.match(/[.,]/g) ?? []).length;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);
  const tailLen = lastSep === -1 ? 0 : s.length - lastSep - 1;
  // Last ./, with 1–2 trailing digits is the decimal mark; longer tail = thousands.
  let intPart = s;
  let fracPart = '';
  if (lastSep !== -1 && tailLen >= 1 && tailLen <= 2) {
    intPart = s.slice(0, lastSep);
    fracPart = s.slice(lastSep + 1);
    if (!/^\d{1,2}$/.test(fracPart)) {
      throw new RangeError(`Invalid amount: ${JSON.stringify(raw)}`);
    }
  } else if (seps === 1 && tailLen === 3) {
    throw new RangeError(`Ambiguous amount, needs human review: ${JSON.stringify(raw)}`);
  }
  const digits = stripThousands(intPart, raw);
  const minor = BigInt(digits) * 100n + BigInt(fracPart.padEnd(2, '0'));
  if (minor > MAX_MINOR) throw new RangeError(`Amount exceeds storage limit: ${JSON.stringify(raw)}`);
  return minor;
}

const err = (code: IssueCode, message: string): RowIssue => ({ code, severity: 'error', message });
const warn = (code: IssueCode, message: string): RowIssue => ({
  code,
  severity: 'warning',
  message,
});

function checkDay(value: string): boolean {
  try {
    assertDayString(value, 'date');
    return true;
  } catch {
    return false;
  }
}

export function validateImportRow(row: ImportRowInput): ValidatedRow {
  if (!Number.isInteger(row.rowNumber) || row.rowNumber < 1) {
    throw new RangeError('rowNumber must be an integer >= 1');
  }
  // Deliberate throw (not per-row blocked): currency comes from the column
  // mapping, so a bad code poisons every row — fail the batch fast.
  assertCurrencyCode(row.currency, 'currency');

  const issues: RowIssue[] = [];
  let amountMinor: bigint | null = null;
  let effectiveDueDate: string | null = null;

  if (isBlank(row.customerName)) {
    issues.push(err('MISSING_CUSTOMER', `Row ${row.rowNumber}: customer name is empty`));
  }
  if (isBlank(row.invoiceNumber)) {
    issues.push(err('MISSING_INVOICE', `Row ${row.rowNumber}: invoice number is empty`));
  }

  if (isBlank(row.remainingRaw)) {
    issues.push(err('INVALID_AMOUNT', `Row ${row.rowNumber}: amount is empty`));
  } else {
    try {
      const minor = parseAmountMinor(row.remainingRaw as string);
      amountMinor = minor;
    } catch {
      issues.push(err('INVALID_AMOUNT', `Row ${row.rowNumber}: amount is not a valid number`));
    }
  }

  const due = row.dueDate?.trim() ?? '';
  const inv = row.invoiceDate?.trim() ?? '';
  if (due) {
    if (checkDay(due)) {
      effectiveDueDate = due;
    } else {
      issues.push(err('INVALID_DUE_DATE', `Row ${row.rowNumber}: due date is not YYYY-MM-DD`));
    }
  } else if (inv) {
    if (checkDay(inv)) {
      effectiveDueDate = addDays(inv, FALLBACK_NET_DAYS);
      issues.push(
        warn('MISSING_DUE_DATE', `Row ${row.rowNumber}: due date defaults to Net ${FALLBACK_NET_DAYS}`),
      );
    } else {
      issues.push(
        err('INVALID_INVOICE_DATE', `Row ${row.rowNumber}: invoice date is not YYYY-MM-DD`),
      );
    }
  } else {
    issues.push(err('MISSING_BOTH_DATES', `Row ${row.rowNumber}: no usable date`));
  }

  const tin = (row.tin ?? '').replace(/\s+/g, '');
  // Space-stripping is normalization, not guessing: digits are identical.
  const tinUsable = TIN_RE.test(tin);
  if (tin && !tinUsable) {
    issues.push(warn('SHORT_TIN', `Row ${row.rowNumber}: TIN must be 9 digits`));
  }
  if (!tinUsable && isBlank(row.externalCustomerId)) {
    issues.push(
      warn('UNMATCHED_CUSTOMER', `Row ${row.rowNumber}: no usable TIN or external id, cannot auto-match`),
    );
  }

  const verdict: Verdict = issues.some((i) => i.severity === 'error')
    ? 'blocked'
    : issues.length > 0
      ? 'warning'
      : 'valid';
  return { rowNumber: row.rowNumber, verdict, issues, amountMinor, effectiveDueDate };
}

/**
 * Idempotency key (§24): org + stable customer ref + invoice. Same file twice
 * yields the same keys — update, not duplicate. Throws on empty parts so a
 * key can never silently collapse two different rows together.
 */
export function importKeyFor(
  organizationId: string,
  customerRef: string,
  invoiceNumber: string,
): string {
  const org = organizationId.trim();
  const ref = customerRef.trim().toUpperCase();
  const inv = invoiceNumber.trim().toUpperCase();
  if (!org || !ref || !inv) throw new RangeError('importKeyFor needs org, ref and invoice');
  // "|" is the key separator: parts containing it would make keys ambiguous.
  for (const [name, part] of [
    ['org', org],
    ['ref', ref],
    ['invoice', inv],
  ] as const) {
    if (part.includes('|')) throw new RangeError(`importKeyFor ${name} must not contain "|"`);
  }
  return `${org}|${ref}|${inv}`;
}

/** Mark rows whose key repeats within one file as blocked. Pure (no input mutation). */
export function applyDuplicateBlocks(rows: readonly ValidatedRow[], keys: readonly string[]): ValidatedRow[] {
  if (rows.length !== keys.length) throw new RangeError('rows and keys must align');
  // Blank keys mean the caller bypassed importKeyFor: fail loud, never collide "".
  for (const k of keys) {
    if (!k) throw new RangeError('keys must be non-empty (use importKeyFor)');
  }
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  if (dupes.size === 0) return [...rows];
  return rows.map((r, i) => {
    const key = keys[i];
    if (key === undefined || !dupes.has(key)) return r;
    const issues = [...r.issues, err('DUPLICATE_IN_FILE', `Row ${r.rowNumber}: duplicate key in file`)];
    return { ...r, verdict: 'blocked' as const, issues };
  });
}

export interface ImportSummary {
  readonly valid: number;
  readonly warnings: number;
  readonly blocked: number;
}

export function summarizeImport(rows: readonly ValidatedRow[]): ImportSummary {
  let valid = 0;
  let warnings = 0;
  let blocked = 0;
  for (const r of rows) {
    if (r.verdict === 'valid') valid += 1;
    else if (r.verdict === 'warning') warnings += 1;
    else blocked += 1;
  }
  return { valid, warnings, blocked };
}
