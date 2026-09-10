import type { AgingBucket } from '@debt-copilot/domain';

export type QueueStatus = 'broken' | 'promise-today' | 'overdue' | 'current';

export interface BucketView {
  readonly bucket: AgingBucket;
  readonly label: string;
  readonly totalUzs: bigint;
  readonly count: number;
}

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

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Not due',
  d1_7: '1–7 days',
  d8_30: '8–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90p: '90+ days',
};

const BUCKET_ORDER: readonly AgingBucket[] = ['current', 'd1_7', 'd8_30', 'd31_60', 'd61_90', 'd90p'];

// ---------------------------------------------------------------------------
// API DTOs → view models. Money arrives as decimal strings, converts to
// BigInt exactly once here. Components stay bigint-only and never change
// whether the source is fixtures (tests) or the API (production).
//
// V1 product decision: KPI cards are UZS-primary (the business is 99% UZS,
// like the mock). Other currencies surface in the USD footnote; the API
// keeps full per-currency maps, so nothing is lost server-side.
// ---------------------------------------------------------------------------

export interface ApiMoney {
  minor: string;
  currency: string;
}

export interface ApiDashboard {
  today: string;
  totals: Record<string, { total: string; overdue: string; buckets: Record<string, { total: string; count: number }> }>;
  dueWeek: Record<string, string>;
  promisedToday: Record<string, string>;
  queue: Array<{
    customerId: string;
    name: string;
    assignee: string;
    invoices: string[];
    outstanding: ApiMoney;
    overdueDays: number;
    broken: number;
    promiseToday: boolean;
    score: number;
  }>;
}

const big = (minor: string, what: string): bigint => {
  try {
    return BigInt(minor);
  } catch {
    throw new RangeError(`API sent non-integer minor for ${what}`);
  }
};

export function toDashboardData(api: ApiDashboard, timeZone: string): DashboardData {
  const uzs = api.totals['UZS'];
  const buckets = BUCKET_ORDER.map((bucket: AgingBucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    totalUzs: big(uzs?.buckets[bucket]?.total ?? '0', `buckets.${bucket}`),
    count: uzs?.buckets[bucket]?.count ?? 0,
  }));
  const totalUzs = big(uzs?.total ?? '0', 'total');
  const overdueUzs = big(uzs?.overdue ?? '0', 'overdue');
  const dueWeekUzs = big(api.dueWeek['UZS'] ?? '0', 'dueWeek');
  const promisedTodayUzs = big(api.promisedToday['UZS'] ?? '0', 'promisedToday');
  const queue: QueueRow[] = api.queue.map((q) => ({
    customerId: q.customerId,
    name: q.name,
    assignee: q.assignee,
    invoiceNumbers: q.invoices,
    outstandingMinor: big(q.outstanding.minor, `${q.customerId}.outstanding`),
    currency: q.outstanding.currency,
    overdueDays: q.overdueDays,
    broken: q.broken,
    promiseToday: q.promiseToday,
    status:
      q.broken > 0
        ? ('broken' as const)
        : q.promiseToday
          ? ('promise-today' as const)
          : q.overdueDays > 0
            ? ('overdue' as const)
            : ('current' as const),
    score: q.score,
  }));

  const lanes = new Map<string, DebtorRow[]>();
  for (const q of queue) {
    const lane = lanes.get(q.currency) ?? [];
    lane.push({
      customerId: q.customerId,
      name: q.name,
      assignee: q.assignee,
      outstandingMinor: q.outstandingMinor,
      currency: q.currency,
    });
    lanes.set(q.currency, lane);
  }
  const debtors: DebtorRow[] = [];
  const order = [...lanes.keys()].sort((a, b) =>
    a === 'UZS' ? -1 : b === 'UZS' ? 1 : a.localeCompare(b),
  );
  for (const lane of order) {
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

  let usdOverdueMinor = 0n;
  const usd = api.totals['USD'];
  if (usd) {
    for (const b of BUCKET_ORDER) {
      if (b !== 'current') usdOverdueMinor += big(usd.buckets[b]?.total ?? '0', `USD.${b}`);
    }
  }

  return {
    today: api.today,
    timeZone,
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
