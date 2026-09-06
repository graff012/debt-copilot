import type { OrgContext } from './types.js';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertDayString(value: string, field: string): void {
  const m = DAY_RE.exec(value);
  if (!m) {
    throw new RangeError(`${field} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`${field} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  // Round-trip through the calendar so 2026-02-30 / 2026-13-01 fail instead of rolling over.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new RangeError(`${field} is not a real calendar day: ${JSON.stringify(value)}`);
  }
}

/** Organization-local calendar day (YYYY-MM-DD) for the injected clock. Zero dependencies. */
export function getOrgToday(ctx: OrgContext): string {
  if (!ctx.organizationId) throw new RangeError('organizationId is required');
  if (!ctx.timeZone) throw new RangeError('timeZone is required');
  if (!(ctx.now instanceof Date) || Number.isNaN(ctx.now.getTime())) {
    throw new RangeError('now must be a valid Date');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ctx.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ctx.now);
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new RangeError(`Cannot resolve ${type} for timeZone ${ctx.timeZone}`);
    return part.value;
  };
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole calendar days from fromDay to toDay (both YYYY-MM-DD). Can be negative. */
export function diffDays(fromDay: string, toDay: string): number {
  assertDayString(fromDay, 'fromDay');
  assertDayString(toDay, 'toDay');
  const ms = Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const DAY_MS = 86_400_000;

/** Shift a YYYY-MM-DD calendar day by n days (n may be negative). */
export function addDays(day: string, n: number): string {
  assertDayString(day, 'day');
  if (!Number.isInteger(n)) throw new RangeError('n must be an integer');
  const dt = new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
  if (Number.isNaN(dt.getTime())) throw new RangeError('date shift out of range');
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
