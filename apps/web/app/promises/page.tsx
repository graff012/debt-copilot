import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOrgToday } from '@debt-copilot/domain';
import { ApiError, api } from '@/lib/api';
import { toPromiseBoard, type ApiPromiseRow } from '@/lib/api-customers';
import type { PromiseRow } from '@/lib/api-customers';
import { formatMoney } from '@/lib/format';

interface Me {
  organizationId: string;
  timeZone: string;
}

function Group({ title, rows, empty }: { title: string; rows: readonly PromiseRow[]; empty: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">
        {title}{' '}
        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {rows.length}
        </span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm"
            >
              <Link
                href={`/customers/${p.customerId}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {p.customerName}
              </Link>
              <span className="font-bold tabular-nums">
                {formatMoney(p.amountMinor, p.currency)}
              </span>
              <span className="text-slate-500">{p.promisedDate}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function PromisesPage() {
  let board;
  try {
    const me = await api<Me>('/auth/me');
    const today = getOrgToday({ organizationId: me.organizationId, timeZone: me.timeZone, now: new Date() });
    const rows = await api<ApiPromiseRow[]>(`/promises?today=${today}`);
    board = { today, ...toPromiseBoard(rows) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    throw err;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Promises</h1>
        <p className="text-sm text-slate-500">Day {board.today} · live from the API</p>
      </header>
      <Group title="Broken" rows={board.broken} empty="No broken promises. Good." />
      <Group title="Due today" rows={board.dueToday} empty="Nothing due today." />
      <Group title="Upcoming" rows={board.upcoming} empty="Nothing upcoming." />
    </div>
  );
}
