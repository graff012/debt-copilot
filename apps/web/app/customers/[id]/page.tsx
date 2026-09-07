import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildCustomerDetail, buildCustomerList } from '@/lib/customers';
import { formatMoney } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';

export function generateStaticParams(): Array<{ id: string }> {
  return buildCustomerList().map((r) => ({ id: r.customerId }));
}

const KIND_LABEL: Record<string, string> = {
  call: 'Call logged',
  note: 'Note',
  promise: 'Promise event',
  overdue: 'Overdue event',
  invoice: 'Invoice',
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail;
  try {
    detail = buildCustomerDetail(id);
  } catch {
    notFound();
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/customers" className="text-sm text-indigo-700 hover:underline">
        ← Back to customers
      </Link>
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          {detail.broken > 0 ? (
            <StatusBadge
              status="broken"
              detail={`${detail.broken} broken ${detail.broken === 1 ? 'promise' : 'promises'}`}
            />
          ) : detail.overdueDays > 0 ? (
            <StatusBadge status="overdue" detail={`${detail.overdueDays} days overdue`} />
          ) : (
            <StatusBadge status="current" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding</p>
            <p className="text-xl font-bold tabular-nums text-red-700">
              {formatMoney(detail.outstandingMinor, detail.currency)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Collector</p>
            <p className="text-xl font-semibold">{detail.assignee}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" title="Wiring in task: customer actions">
          {['Record payment', 'Promise received', 'Log call', 'Add note'].map((label) => (
            <span
              key={label}
              aria-disabled="true"
              className="cursor-not-allowed rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-400"
            >
              {label}
            </span>
          ))}
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Invoices ({detail.invoices.length})</h2>
        <ul className="mt-3 space-y-2">
          {detail.invoices.map((inv) => (
            <li
              key={inv.invoiceNumber}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm"
            >
              <span className="font-medium">{inv.invoiceNumber}</span>
              <span className="text-slate-500">due {inv.dueDate}</span>
              <span className="font-bold tabular-nums">
                {formatMoney(inv.remainingMinor, inv.currency)}
              </span>
              <StatusBadge
                status={inv.state === 'overdue' ? 'overdue' : 'current'}
                detail={
                  inv.state === 'overdue'
                    ? `${inv.overdueDays} days overdue`
                    : inv.state === 'due-today'
                      ? 'Due today'
                      : inv.state === 'paid'
                        ? 'Paid'
                        : 'Upcoming'
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Promises ({detail.promises.length})</h2>
        <ul className="mt-3 space-y-2">
          {detail.promises.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm"
            >
              <span className="font-medium tabular-nums">
                {formatMoney(p.amountMinor, p.currency)}
              </span>
              <span className="text-slate-500">{p.promisedDate}</span>
              <StatusBadge
                status={p.state === 'broken' ? 'broken' : p.state === 'due-today' ? 'promise-today' : 'current'}
                detail={
                  p.state === 'broken'
                    ? 'Broken'
                    : p.state === 'due-today'
                      ? 'Due today'
                      : p.state === 'upcoming'
                        ? 'Upcoming'
                        : p.state
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Activity timeline ({detail.timeline.length} events)</h2>
        <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
          {detail.timeline.map((e, i) => (
            <li key={`${e.day}-${e.kind}-${i}`}>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {e.day} · {KIND_LABEL[e.kind] ?? e.kind}
              </p>
              <p className="font-medium">{e.title}</p>
              {e.body ? <p className="text-sm text-slate-600">{e.body}</p> : null}
              {e.author ? <p className="text-xs text-slate-500">— {e.author}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
