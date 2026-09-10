import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOrgToday } from '@debt-copilot/domain';
import { StatusBadge } from '@/components/StatusBadge';
import { ApiError, api } from '@/lib/api';
import { toCustomerRows, toQueueStatus, type ApiCustomerRow } from '@/lib/api-customers';
import { formatMoney } from '@/lib/format';

interface Me {
  organizationId: string;
  timeZone: string;
}

async function load() {
  const me = await api<Me>('/auth/me');
  const today = getOrgToday({ organizationId: me.organizationId, timeZone: me.timeZone, now: new Date() });
  const rows = await api<ApiCustomerRow[]>(`/customers?today=${today}`);
  return toCustomerRows(rows);
}

export default async function CustomersPage() {
  let rows;
  try {
    rows = await load();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    throw err;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-slate-500">{rows.length} debtors · live from the API</p>
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
            {rows.map((r) => {
              const status = toQueueStatus(r.broken, r.promiseToday, r.overdueDays);
              return (
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
                    {r.totals.map((t) => (
                      <span key={t.currency} className="mr-2">
                        {formatMoney(t.minor, t.currency)}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    {status === 'broken' ? (
                      <StatusBadge
                        status="broken"
                        detail={`${r.broken} broken ${r.broken === 1 ? 'promise' : 'promises'}`}
                      />
                    ) : status === 'promise-today' ? (
                      <StatusBadge status="promise-today" />
                    ) : status === 'overdue' ? (
                      <StatusBadge status="overdue" detail={`${r.overdueDays} days overdue`} />
                    ) : (
                      <StatusBadge status="current" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.assignee}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
