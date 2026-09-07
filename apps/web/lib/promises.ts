import { getOrgToday } from '@debt-copilot/domain';
import {
  CUSTOMERS,
  DEMO_NOW,
  ORG_ID,
  PROMISES,
  TIME_ZONE,
} from './fixtures';

// ---------------------------------------------------------------------------
// Promises board: OPEN promises grouped by time state. Recorded KEPT /
// CANCELLED / BROKEN rows are history, not board items (shown on detail).
// ---------------------------------------------------------------------------

export type BoardGroup = 'due-today' | 'upcoming' | 'broken';

export interface PromiseRow {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly assignee: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly promisedDate: string;
  readonly group: BoardGroup;
}

export interface PromisesBoard {
  readonly today: string;
  readonly dueToday: readonly PromiseRow[];
  readonly upcoming: readonly PromiseRow[];
  readonly broken: readonly PromiseRow[];
}

function meta(customerId: string): { name: string; assignee: string } {
  const m = CUSTOMERS[customerId];
  if (!m) throw new RangeError(`Fixture customer missing: ${customerId}`);
  return m;
}

export function buildPromisesBoard(): PromisesBoard {
  const today = getOrgToday({ organizationId: ORG_ID, timeZone: TIME_ZONE, now: DEMO_NOW });
  const dueToday: PromiseRow[] = [];
  const upcoming: PromiseRow[] = [];
  const broken: PromiseRow[] = [];
  for (const p of PROMISES) {
    if (p.organizationId !== ORG_ID) throw new RangeError(`Promise ${p.id} belongs to another org`);
    if (p.status !== 'OPEN') continue;
    const { name, assignee } = meta(p.customerId);
    const row: PromiseRow = {
      id: p.id,
      customerId: p.customerId,
      customerName: name,
      assignee,
      amountMinor: p.amount.minor,
      currency: p.amount.currency,
      promisedDate: p.promisedDate,
      group: p.promisedDate < today ? 'broken' : p.promisedDate === today ? 'due-today' : 'upcoming',
    };
    if (row.group === 'broken') broken.push(row);
    else if (row.group === 'due-today') dueToday.push(row);
    else upcoming.push(row);
  }
  const byDate = (a: PromiseRow, b: PromiseRow): number =>
    a.promisedDate === b.promisedDate ? a.id.localeCompare(b.id) : a.promisedDate < b.promisedDate ? -1 : 1;
  broken.sort(byDate);
  const byAmount = (a: PromiseRow, b: PromiseRow): number =>
    a.amountMinor === b.amountMinor ? a.id.localeCompare(b.id) : a.amountMinor > b.amountMinor ? -1 : 1;
  dueToday.sort(byAmount);
  upcoming.sort(byDate);
  return { today, dueToday, upcoming, broken };
}
