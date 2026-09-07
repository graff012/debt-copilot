import {
  addDays,
  amountTierFor,
  calculatePriority,
  diffDays,
  getOrgToday,
  isOverdue,
  isPromiseBroken,
  type PromiseToPay,
} from '@debt-copilot/domain';
import {
  ACTIVITY_NOTES,
  CUSTOMERS,
  DEMO_NOW,
  NO_CONTACT_DAYS,
  ORG_ID,
  PROMISES,
  RECEIVABLES,
  TIME_ZONE,
  type FixtureReceivable,
} from './fixtures';

// ---------------------------------------------------------------------------
// Customer detail view models. Derived from domain + fixtures; the [id] route
// calls notFound() on the RangeErrors below (unknown customer).
// ---------------------------------------------------------------------------

export type InvoiceState = 'overdue' | 'due-today' | 'upcoming' | 'paid';

export interface InvoiceView {
  readonly invoiceNumber: string;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly originalMinor: bigint;
  readonly remainingMinor: bigint;
  readonly currency: string;
  readonly overdueDays: number;
  readonly state: InvoiceState;
}

export type PromiseState = 'broken' | 'due-today' | 'upcoming' | 'kept' | 'cancelled';

export interface PromiseView {
  readonly id: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly promisedDate: string;
  readonly state: PromiseState;
}

export type TimelineKind = 'call' | 'note' | 'promise' | 'overdue' | 'invoice';

export interface TimelineEvent {
  readonly day: string;
  readonly kind: TimelineKind;
  readonly title: string;
  readonly body: string;
  readonly author: string;
}

export interface CustomerDetail {
  readonly customerId: string;
  readonly name: string;
  readonly assignee: string;
  readonly currency: string;
  readonly outstandingMinor: bigint;
  readonly overdueDays: number;
  readonly broken: number;
  readonly invoices: readonly InvoiceView[];
  readonly promises: readonly PromiseView[];
  readonly timeline: readonly TimelineEvent[];
}

export interface CustomerListRow {
  readonly customerId: string;
  readonly name: string;
  readonly assignee: string;
  readonly outstandingMinor: bigint;
  readonly currency: string;
  readonly overdueDays: number;
  readonly broken: number;
  readonly promiseToday: boolean;
  readonly score: number;
}

function customerMeta(customerId: string): { name: string; assignee: string } {
  const m = CUSTOMERS[customerId];
  if (!m) throw new RangeError(`Unknown customer: ${customerId}`);
  return m;
}

function promiseState(p: PromiseToPay, today: string): PromiseState {
  if (p.status === 'OPEN') {
    if (isPromiseBroken(p, today)) return 'broken';
    return p.promisedDate === today ? 'due-today' : 'upcoming';
  }
  if (p.status === 'BROKEN') return 'broken';
  return p.status === 'KEPT' ? 'kept' : 'cancelled';
}

/** Deterministic rank inside one day: human events read first. */
const KIND_RANK: Record<TimelineKind, number> = {
  call: 0,
  note: 1,
  promise: 2,
  overdue: 3,
  invoice: 4,
};

export function buildCustomerDetail(customerId: string): CustomerDetail {
  const { name, assignee } = customerMeta(customerId);
  const ctx = { organizationId: ORG_ID, timeZone: TIME_ZONE, now: DEMO_NOW };
  const today = getOrgToday(ctx);

  const rows = RECEIVABLES.filter((r) => r.customerId === customerId);
  if (rows.length === 0) throw new RangeError(`Unknown customer: ${customerId}`);
  const currency = rows[0]?.remaining.currency ?? 'UZS';

  let outstandingMinor = 0n;
  let overdueDays = 0;
  const invoices: InvoiceView[] = [];
  const timeline: TimelineEvent[] = [];
  for (const r of rows as readonly FixtureReceivable[]) {
    if (r.organizationId !== ORG_ID) throw new RangeError(`Receivable ${r.id} belongs to another org`);
    if (r.remaining.currency !== currency) {
      throw new RangeError(`Customer ${customerId} mixes currencies in fixtures`);
    }
    outstandingMinor += r.remaining.minor;
    const overdue = isOverdue(r, today);
    const d = overdue ? diffDays(r.dueDate, today) : 0;
    if (d > overdueDays) overdueDays = d;
    const state: InvoiceState =
      r.remaining.minor === 0n ? 'paid' : overdue ? 'overdue' : r.dueDate === today ? 'due-today' : 'upcoming';
    invoices.push({
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      originalMinor: r.original.minor,
      remainingMinor: r.remaining.minor,
      currency,
      overdueDays: d,
      state,
    });
    timeline.push({
      day: r.invoiceDate,
      kind: 'invoice',
      title: `Invoice ${r.invoiceNumber} issued`,
      body: '',
      author: '',
    });
    if (overdue) {
      timeline.push({
        day: addDays(r.dueDate, 1),
        kind: 'overdue',
        title: `Invoice ${r.invoiceNumber} flipped to overdue`,
        body: 'Grace period expired.',
        author: 'System',
      });
    }
  }

  let broken = 0;
  const promises: PromiseView[] = [];
  for (const p of PROMISES) {
    if (p.customerId !== customerId) continue;
    if (p.organizationId !== ORG_ID) throw new RangeError(`Promise ${p.id} belongs to another org`);
    const state = promiseState(p, today);
    if (state === 'broken') broken += 1;
    promises.push({
      id: p.id,
      amountMinor: p.amount.minor,
      currency: p.amount.currency,
      promisedDate: p.promisedDate,
      state,
    });
    timeline.push({
      day: p.promisedDate,
      kind: 'promise',
      title:
        state === 'broken'
          ? `Broken promise: ${p.id}`
          : state === 'due-today'
            ? `Promise due today: ${p.id}`
            : `Promise recorded: ${p.id}`,
      body: '',
      author: '',
    });
  }
  promises.sort((a, b) =>
    a.promisedDate === b.promisedDate ? a.id.localeCompare(b.id) : a.promisedDate < b.promisedDate ? -1 : 1,
  );

  for (const n of ACTIVITY_NOTES) {
    if (n.customerId !== customerId) continue;
    timeline.push({ day: n.day, kind: n.kind, title: n.title, body: n.body, author: n.author });
  }
  timeline.sort(
    (a, b) =>
      a.day < b.day ? 1 : a.day > b.day ? -1 : KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.localeCompare(b.title),
  );

  return {
    customerId,
    name,
    assignee,
    currency,
    outstandingMinor,
    overdueDays,
    broken,
    invoices,
    promises,
    timeline,
  };
}

export function buildCustomerList(): CustomerListRow[] {
  const rows: CustomerListRow[] = [];
  for (const customerId of Object.keys(CUSTOMERS)) {
    const hasInvoices = RECEIVABLES.some((r) => r.customerId === customerId);
    if (!hasInvoices) continue; // Not listable as a debtor until first invoice.
    const d = buildCustomerDetail(customerId);
    let promiseToday = false;
    for (const p of d.promises) {
      if (p.state === 'due-today') promiseToday = true;
    }
    const noContact = NO_CONTACT_DAYS[customerId] ?? 0;
    rows.push({
      customerId,
      name: d.name,
      assignee: d.assignee,
      outstandingMinor: d.outstandingMinor,
      currency: d.currency,
      overdueDays: d.overdueDays,
      broken: d.broken,
      promiseToday,
      score: calculatePriority({
        overdueDays: d.overdueDays,
        brokenPromises: d.broken,
        noContactDays: noContact,
        amountTier: amountTierFor({ minor: d.outstandingMinor, currency: d.currency }),
      }),
    });
  }
  // Same tiebreaks as the dashboard queue: score, overdue days, name.
  rows.sort(
    (a, b) => b.score - a.score || b.overdueDays - a.overdueDays || a.name.localeCompare(b.name),
  );
  return rows;
}
