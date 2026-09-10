import type { BucketView } from '@/lib/api-dashboard';
import { formatMillions } from '@/lib/format';

const BAR_COLORS: Record<string, string> = {
  current: 'bg-slate-300',
  d1_7: 'bg-indigo-400',
  d8_30: 'bg-indigo-600',
  d31_60: 'bg-slate-500',
  d61_90: 'bg-amber-500',
  d90p: 'bg-red-600',
};

export function AgingBar({ buckets, total }: { buckets: readonly BucketView[]; total: bigint }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Receivables aging schedule (UZS)</h2>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {buckets.map((b) => {
          const pct = total === 0n ? 0 : Number((b.totalUzs * 10000n) / total) / 100;
          if (pct <= 0) return null;
          return (
            <div
              key={b.bucket}
              className={BAR_COLORS[b.bucket] ?? 'bg-slate-400'}
              style={{ width: `${pct}%` }}
              title={`${b.label}: ${b.count} accounts`}
            />
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {buckets.map((b) => (
          <div key={b.bucket} className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-500">{b.label}</p>
            <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
              {formatMillions(b.totalUzs, 'UZS')}
            </p>
            <p className="text-xs text-slate-500">{b.count} accounts</p>
          </div>
        ))}
      </div>
    </section>
  );
}
