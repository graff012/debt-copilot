import Link from 'next/link';
import { buildCustomerList } from '@/lib/customers';
import { formatMoney } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';

export default function CustomersPage() {
  const rows = buildCustomerList();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-slate-500">
          {rows.length} debtors · demo fixtures, computed by @debt-copilot/domain
        </p>
      </header>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Outstanding</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Assignee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customerId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/customers/${r.customerId}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-bold tabular-nums">
                  {formatMoney(r.outstandingMinor, r.currency)}
                </td>
                <td className="px-4 py-3">
                  {r.broken > 0 ? (
                    <StatusBadge
                      status="broken"
                      detail={`${r.broken} broken ${r.broken === 1 ? 'promise' : 'promises'}`}
                    />
                  ) : r.promiseToday ? (
                    <StatusBadge status="promise-today" />
                  ) : r.overdueDays > 0 ? (
                    <StatusBadge status="overdue" detail={`${r.overdueDays} days overdue`} />
                  ) : (
                    <StatusBadge status="current" />
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{r.assignee}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
