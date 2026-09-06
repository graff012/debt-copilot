import { formatMoney } from '@/lib/format';

interface Kpi {
  readonly label: string;
  readonly minor: bigint;
  readonly currency: string;
  readonly sub: string;
  readonly accent: string;
}

export function KpiCards({
  total,
  overdue,
  dueWeek,
  promisedToday,
}: {
  total: bigint;
  overdue: bigint;
  dueWeek: bigint;
  promisedToday: bigint;
}) {
  const kpis: Kpi[] = [
    { label: 'Total receivables', minor: total, currency: 'UZS', sub: 'Open accounts', accent: 'text-slate-900' },
    { label: 'Overdue debt', minor: overdue, currency: 'UZS', sub: 'Needs action', accent: 'text-red-700' },
    { label: 'Due within 7 days', minor: dueWeek, currency: 'UZS', sub: 'Upcoming claims', accent: 'text-indigo-700' },
    { label: 'Promised today', minor: promisedToday, currency: 'UZS', sub: 'Expected in', accent: 'text-emerald-700' },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k.label}</p>
          <p className={`mt-2 text-2xl font-bold tabular-nums ${k.accent}`}>
            {formatMoney(k.minor, k.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{k.sub}</p>
        </div>
      ))}
    </div>
  );
}
