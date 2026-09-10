import type { QueueStatus } from './api-dashboard';

// ---------------------------------------------------------------------------
// API DTOs → view models for customers/detail/promises pages. Same contract
// as lib/api-dashboard.ts: decimal strings become BigInt exactly once here.
// ---------------------------------------------------------------------------

const big = (minor: string, what: string): bigint => {
  try {
    return BigInt(minor);
  } catch {
    throw new RangeError(`API sent non-integer minor for ${what}`);
  }
};

export interface ApiLane {
  minor: string;
  currency: string;
}

export interface ApiCustomerRow {
  id: string;
  name: string;
  assignee: string;
  totals: ApiLane[];
  overdueDays: number;
  broken: number;
  promiseToday: boolean;
}

export interface CustomerRow {
  customerId: string;
  name: string;
  assignee: string;
  totals: Array<{ minor: bigint; currency: string }>;
  overdueDays: number;
  broken: number;
  promiseToday: boolean;
}

export function toCustomerRows(api: ApiCustomerRow[]): CustomerRow[] {
  return api.map((c) => ({
    customerId: c.id,
    name: c.name,
    assignee: c.assignee,
    totals: c.totals.map((t) => ({ minor: big(t.minor, `${c.id}.total`), currency: t.currency })),
    overdueDays: c.overdueDays,
    broken: c.broken,
    promiseToday: c.promiseToday,
  }));
}

export type InvoiceState = 'overdue' | 'due-today' | 'upcoming' | 'paid';
export type PromiseState = 'broken' | 'due-today' | 'upcoming' | 'kept' | 'cancelled';

export interface ApiCustomerDetail {
  customer: { id: string; name: string; phone: string | null; taxId: string | null; assignee: string };
  totals: ApiLane[];
  overdueDays: number;
  broken: number;
  invoices: Array<{
    invoiceNumber: string;
    dueDate: string;
    remaining: ApiLane;
    overdueDays: number;
  }>;
  promises: Array<{
    id: string;
    amount: ApiLane;
    promisedDate: string;
    state: string;
  }>;
  timeline: Array<{ day: string; kind: string; title: string; body: string; author: string }>;
}

export interface CustomerDetail {
  customerId: string;
  name: string;
  assignee: string;
  totals: Array<{ minor: bigint; currency: string }>;
  overdueDays: number;
  broken: number;
  invoices: Array<{
    invoiceNumber: string;
    dueDate: string;
    remainingMinor: bigint;
    currency: string;
    overdueDays: number;
    state: InvoiceState;
  }>;
  promises: Array<{
    id: string;
    amountMinor: bigint;
    currency: string;
    promisedDate: string;
    state: PromiseState;
  }>;
  timeline: Array<{ day: string; kind: string; title: string; body: string; author: string }>;
}

const PROMISE_STATES: ReadonlySet<string> = new Set([
  'broken',
  'due-today',
  'upcoming',
  'kept',
  'cancelled',
]);

export function toCustomerDetail(api: ApiCustomerDetail, today: string): CustomerDetail {
  return {
    customerId: api.customer.id,
    name: api.customer.name,
    assignee: api.customer.assignee,
    totals: api.totals.map((t) => ({
      minor: big(t.minor, 'totals'),
      currency: t.currency,
    })),
    overdueDays: api.overdueDays,
    broken: api.broken,
    invoices: api.invoices.map((inv) => {
      // State derives from fields (never trusts display strings from the wire).
      // BigInt compare: '00' is paid too, string compare would miss it.
      const remaining = big(inv.remaining.minor, `${inv.invoiceNumber}.remaining`);
      const state: InvoiceState =
        remaining === 0n
          ? 'paid'
          : inv.overdueDays > 0
            ? 'overdue'
            : inv.dueDate === today
              ? 'due-today'
              : 'upcoming';
      return {
        invoiceNumber: inv.invoiceNumber,
        dueDate: inv.dueDate,
        remainingMinor: remaining,
        currency: inv.remaining.currency,
        overdueDays: inv.overdueDays,
        state,
      };
    }),
    promises: api.promises.map((p) => {
      if (!PROMISE_STATES.has(p.state)) throw new RangeError(`Unknown promise state: ${p.state}`);
      return {
        id: p.id,
        amountMinor: big(p.amount.minor, `${p.id}.amount`),
        currency: p.amount.currency,
        promisedDate: p.promisedDate,
        state: p.state as PromiseState,
      };
    }),
    timeline: api.timeline.map((e) => ({ ...e })),
  };
}

export interface ApiPromiseRow {
  id: string;
  customerId: string;
  customerName: string;
  amount: ApiLane;
  promisedDate: string;
  group: string;
}

export interface PromiseBoard {
  dueToday: PromiseRow[];
  upcoming: PromiseRow[];
  broken: PromiseRow[];
}

export interface PromiseRow {
  id: string;
  customerId: string;
  customerName: string;
  amountMinor: bigint;
  currency: string;
  promisedDate: string;
}

export function toPromiseBoard(api: ApiPromiseRow[]): PromiseBoard {
  const dueToday: PromiseRow[] = [];
  const upcoming: PromiseRow[] = [];
  const broken: PromiseRow[] = [];
  for (const p of api) {
    const row: PromiseRow = {
      id: p.id,
      customerId: p.customerId,
      customerName: p.customerName,
      amountMinor: big(p.amount.minor, `${p.id}.amount`),
      currency: p.amount.currency,
      promisedDate: p.promisedDate,
    };
    if (p.group === 'broken') broken.push(row);
    else if (p.group === 'today') dueToday.push(row);
    else if (p.group === 'upcoming') upcoming.push(row);
    else throw new RangeError(`Unknown promise group: ${p.group}`);
  }
  return { dueToday, upcoming, broken };
}

export function toQueueStatus(broken: number, promiseToday: boolean, overdueDays: number): QueueStatus {
  return broken > 0 ? 'broken' : promiseToday ? 'promise-today' : overdueDays > 0 ? 'overdue' : 'current';
}
