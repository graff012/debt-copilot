import type { QueueRow } from '@/lib/api-dashboard';
import { formatMoney } from '@/lib/format';
import { StatusBadge } from './StatusBadge';

const ROW_BORDER: Record<string, string> = {
  broken: 'border-l-4 border-l-red-600',
  'promise-today': 'border-l-4 border-l-violet-600',
  overdue: 'border-l-4 border-l-red-400',
  current: 'border-l-4 border-l-emerald-500',
};

export function TodayQueue({ rows }: { rows: readonly QueueRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">
        Today priority queue{' '}
        <span className="ml-1 rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">
          {rows.length}
        </span>
      </h2>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li
            key={`${r.customerId}|${r.currency}`}
            className={`rounded-lg border border-slate-200 bg-white p-4 ${ROW_BORDER[r.status] ?? ''}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-900">{r.name}</p>
              <span className="text-xs text-slate-500">{r.invoiceNumbers.join(', ')}</span>
              {r.broken > 0 ? (
                <StatusBadge
                  status="broken"
                  detail={`${r.broken} broken ${r.broken === 1 ? 'promise' : 'promises'}`}
                />
              ) : (
                <StatusBadge
                  status={r.status}
                  detail={
                    r.status === 'overdue'
                      ? `${r.overdueDays} days overdue`
                      : r.status === 'promise-today'
                        ? 'Promise due today'
                        : undefined
                  }
                />
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-bold tabular-nums text-slate-900">
                {formatMoney(r.outstandingMinor, r.currency)}
              </span>
              <span className="text-xs text-slate-500">Rep: {r.assignee}</span>
              <span className="text-xs text-slate-400">Score {r.score}</span>
            </div>
            {/* Actions land with customer-detail routes (task: port). */}
          </li>
        ))}
      </ul>
    </section>
  );
}
