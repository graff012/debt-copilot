import {
  addDays,
  amountTierFor,
  calculateAgingForOrg,
  calculatePriority,
  countAging,
  diffDays,
  getOrgToday,
  isOverdue,
  isPromiseBroken,
  type AgingBucket,
  type Receivable,
} from '@debt-copilot/domain';
import {
  CUSTOMERS,
  DEMO_NOW,
  DEMO_TODAY,
  NO_CONTACT_DAYS,
  ORG_ID,
  PROMISES,
  RECEIVABLES,
  TIME_ZONE,
} from './fixtures';

// ---------------------------------------------------------------------------
// View models. Every number derives from domain functions over fixtures.
// Nothing is hardcoded: change a fixture, the dashboard must follow.
// Money is never compared across currencies; scores are (they're unitless).
// ---------------------------------------------------------------------------

export interface BucketView {
  readonly bucket: AgingBucket;
  readonly label: string;
  readonly totalUzs: bigint;
  readonly count: number;
}

export type QueueStatus = 'broken' | 'promise-today' | 'overdue' | 'current';

export interface QueueRow {
  readonly customerId: string;
  readonly name: string;
  readonly assignee: string;
  readonly invoiceNumbers: readonly string[];
  readonly outstandingMinor: bigint;
  readonly currency: string;
  readonly overdueDays: number;
  readonly broken: number;
  readonly promiseToday: boolean;
  readonly status: QueueStatus;
  readonly score: number;
}

export interface DebtorRow {
  readonly customerId: string;
  readonly name: string;
  readonly assignee: string;
  readonly outstandingMinor: bigint;
  readonly currency: string;
}

export interface DashboardData {
  readonly today: string;
  readonly timeZone: string;
  readonly totalUzs: bigint;
  readonly overdueUzs: bigint;
  readonly dueWeekUzs: bigint;
  readonly promisedTodayUzs: bigint;
  readonly usdOverdueMinor: bigint;
  readonly buckets: readonly BucketView[];
  readonly queue: readonly QueueRow[];
  readonly debtors: readonly DebtorRow[];
}

export const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Not due',
  d1_7: '1–7 days',
  d8_30: '8–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90p: '90+ days',
};

export const BUCKET_ORDER: readonly AgingBucket[] = ['current', 'd1_7', 'd8_30', 'd31_60', 'd61_90', 'd90p'];

function meta(customerId: string): { name: string; assignee: string } {
  const m = CUSTOMERS[customerId];
  if (!m) throw new RangeError(`Fixture customer missing: ${customerId}`);
  return m;
}

function contactDays(customerId: string): number {
  const n = NO_CONTACT_DAYS[customerId];
  if (n === undefined) throw new RangeError(`Fixture contact days missing: ${customerId}`);
  return n;
}

export function buildDashboard(): DashboardData {
  // Demo today derives from the org clock, never server-local midnight.
  const ctx = { organizationId: ORG_ID, timeZone: TIME_ZONE, now: DEMO_NOW };
  const today = getOrgToday(ctx);
  if (today !== DEMO_TODAY) throw new RangeError(`Fixture drift: demo today moved to ${today}`);

  // Fixture sets are single-org by construction; both loops enforce it.
  const schedule = calculateAgingForOrg(RECEIVABLES, ctx);
  const counts = countAging(RECEIVABLES, today, ORG_ID);
  for (const p of PROMISES) {
    if (p.organizationId !== ORG_ID) throw new RangeError(`Promise ${p.id} belongs to another org`);
  }

  const uzs = schedule['UZS'] ?? {
    current: 0n,
    d1_7: 0n,
    d8_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90p: 0n,
  };
  const uzsCounts = counts['UZS'];
  const usd = schedule['USD'];

  const buckets: BucketView[] = BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    totalUzs: uzs[bucket],
    count: uzsCounts?.[bucket] ?? 0,
  }));

  const totalUzs = BUCKET_ORDER.reduce((s, b) => s + uzs[b], 0n);
  const overdueUzs = BUCKET_ORDER.filter((b) => b !== 'current').reduce((s, b) => s + uzs[b], 0n);

  const weekEnd = addDays(today, 7);
  let dueWeekUzs = 0n;
  for (const r of RECEIVABLES) {
    if (r.remaining.currency !== 'UZS' || r.remaining.minor === 0n) continue;
    if (r.dueDate >= today && r.dueDate <= weekEnd) dueWeekUzs += r.remaining.minor;
  }

  let promisedTodayUzs = 0n;
  for (const p of PROMISES) {
    if (p.status === 'OPEN' && p.promisedDate === today && p.amount.currency === 'UZS') {
      promisedTodayUzs += p.amount.minor;
    }
  }

  let usdOverdueMinor = 0n;
  if (usd) {
    for (const b of BUCKET_ORDER) {
      if (b !== 'current') usdOverdueMinor += usd[b];
    }
  }

  const byCustomer = new Map<string, Receivable[]>();
  for (const r of RECEIVABLES) {
    const list = byCustomer.get(r.customerId) ?? [];
    list.push(r);
    byCustomer.set(r.customerId, list);
  }
  const queue: QueueRow[] = [];
  for (const [customerId, rows] of byCustomer) {
    const { name, assignee } = meta(customerId);
    const currency = rows[0]?.remaining.currency ?? 'UZS';
    let outstandingMinor = 0n;
    let overdueDays = 0;
    const invoices: string[] = [];
    for (const r of rows) {
      if (r.remaining.currency !== currency) {
        throw new RangeError(`Customer ${customerId} mixes currencies in fixtures`);
      }
      outstandingMinor += r.remaining.minor;
      invoices.push(r.invoiceNumber);
      if (isOverdue(r, today)) {
        const d = diffDays(r.dueDate, today);
        if (d > overdueDays) overdueDays = d;
      }
    }
    let broken = 0;
    let promiseToday = false;
    for (const p of PROMISES) {
      if (p.customerId !== customerId) continue;
      if (p.status === 'BROKEN' || isPromiseBroken(p, today)) broken += 1;
      if (p.status === 'OPEN' && p.promisedDate === today) promiseToday = true;
    }
    const score = calculatePriority({
      overdueDays,
      brokenPromises: broken,
      noContactDays: contactDays(customerId),
      amountTier: amountTierFor({ minor: outstandingMinor, currency }),
    });
    const status: QueueStatus =
      broken > 0 ? 'broken' : promiseToday ? 'promise-today' : overdueDays > 0 ? 'overdue' : 'current';
    queue.push({
      customerId,
      name,
      assignee,
      invoiceNumbers: invoices,
      outstandingMinor,
      currency,
      overdueDays,
      broken,
      promiseToday,
      status,
      score,
    });
  }
  // Scores are unitless: comparable across currencies (money never is).
  // Tiebreaks keep the order deterministic.
  queue.sort(
    (a, b) => b.score - a.score || b.overdueDays - a.overdueDays || a.name.localeCompare(b.name),
  );

  // Exposure ranks within each currency lane; UZS lane first.
  const lanes = new Map<string, DebtorRow[]>();
  for (const [customerId, rows] of byCustomer) {
    const { name, assignee } = meta(customerId);
    const currency = rows[0]?.remaining.currency ?? 'UZS';
    let minor = 0n;
    for (const r of rows) minor += r.remaining.minor;
    const lane = lanes.get(currency) ?? [];
    lane.push({ customerId, name, assignee, outstandingMinor: minor, currency });
    lanes.set(currency, lane);
  }
  const debtors: DebtorRow[] = [];
  const laneOrder = [...lanes.keys()].sort((a, b) => (a === 'UZS' ? -1 : b === 'UZS' ? 1 : a.localeCompare(b)));
  for (const lane of laneOrder) {
    const rows = lanes.get(lane) ?? [];
    rows.sort((a, b) =>
      a.outstandingMinor === b.outstandingMinor
        ? a.name.localeCompare(b.name)
        : a.outstandingMinor < b.outstandingMinor
          ? 1
          : -1,
    );
    debtors.push(...rows);
  }

  return {
    today,
    timeZone: TIME_ZONE,
    totalUzs,
    overdueUzs,
    dueWeekUzs,
    promisedTodayUzs,
    usdOverdueMinor,
    buckets,
    queue,
    debtors,
  };
}
