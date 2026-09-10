import { parseAmountMinor } from '@debt-copilot/domain';

// ---------------------------------------------------------------------------
// Pure input parsers for the bot conversation flows. Tested, no I/O.
// ---------------------------------------------------------------------------

const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function shiftDay(day: string, n: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Human day words → YYYY-MM-DD. Returns null when it cannot tell (ask again). */
export function parseDayInput(text: string, today: string): string | null {
  const s = text.trim().toLowerCase();
  if (s === 'today' || s === 'сегодня') return today;
  if (s === 'tomorrow' || s === 'завтра') return shiftDay(today, 1);
  const dmy = /^(\d{1,2})[.](\d{1,2})[.](\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  }
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) return s;
  const weekday = WEEKDAYS_EN.indexOf(s);
  if (weekday !== -1) {
    const current = new Date(`${today}T00:00:00Z`).getUTCDay();
    let delta = (weekday - current + 7) % 7;
    if (delta === 0) delta = 7; // Same weekday = next week, never today.
    return shiftDay(today, delta);
  }
  return null;
}

/** 'full' → fullMinor, else strict domain parse. Throws on garbage (ask again). */
export function parseAmountInput(text: string, fullMinor: bigint): bigint {
  const s = text.trim().toLowerCase();
  if (s === 'full' || s === 'полностью' || s === 'hamma') return fullMinor;
  const minor = parseAmountMinor(text.trim());
  if (minor <= 0n) throw new RangeError('Amount must be positive');
  return minor;
}
