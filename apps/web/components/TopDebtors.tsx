import type { DebtorRow } from '@/lib/api-dashboard';
import { formatMoney } from '@/lib/format';

export function TopDebtors({ rows }: { rows: readonly DebtorRow[] }) {
  const shown = rows.slice(0, 5);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">
        Top debtors{' '}
        <span className="font-normal text-slate-500">
          top {shown.length} of {rows.length}
        </span>
      </h2>
      <ol className="mt-4 space-y-3">
        {shown.map((d, i) => (
          <li key={`${d.customerId}|${d.currency}`} className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="mr-2 text-xs tabular-nums text-slate-400">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="font-medium text-slate-900">{d.name}</span>
              <p className="ml-7 text-xs text-slate-500">Assignee: {d.assignee}</p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
              {formatMoney(d.outstandingMinor, d.currency)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
