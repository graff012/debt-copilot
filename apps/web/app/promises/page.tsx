import Link from 'next/link';
import { buildPromisesBoard, type PromiseRow } from '@/lib/promises';
import { formatMoney } from '@/lib/format';

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
              <span className="text-xs text-slate-500">{p.assignee}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PromisesPage() {
  const board = buildPromisesBoard();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Promises</h1>
        <p className="text-sm text-slate-500">Day {board.today} · demo fixtures</p>
      </header>
      <Group title="Broken" rows={board.broken} empty="No broken promises. Good." />
      <Group title="Due today" rows={board.dueToday} empty="Nothing due today." />
      <Group title="Upcoming" rows={board.upcoming} empty="Nothing upcoming." />
    </div>
  );
}
