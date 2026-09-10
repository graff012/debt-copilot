import { redirect } from 'next/navigation';
import { getOrgToday } from '@debt-copilot/domain';
import { AgingBar } from '@/components/AgingBar';
import { KpiCards } from '@/components/KpiCards';
import { TodayQueue } from '@/components/TodayQueue';
import { TopDebtors } from '@/components/TopDebtors';
import { ApiError, api } from '@/lib/api';
import { toDashboardData, type ApiDashboard } from '@/lib/api-dashboard';
import { formatMoney } from '@/lib/format';

interface Me {
  organizationId: string;
  timeZone: string;
}

async function load() {
  const me = await api<Me>('/auth/me');
  const today = getOrgToday({ organizationId: me.organizationId, timeZone: me.timeZone, now: new Date() });
  const dto = await api<ApiDashboard>(`/dashboard?today=${today}`);
  return toDashboardData(dto, me.timeZone);
}

export default async function DashboardPage() {
  let data;
  try {
    data = await load();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    throw err;
  }
  const d = data;
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Collections overview</h1>
        <p className="text-sm text-slate-500">
          Day {d.today} ({d.timeZone}) · live from the API
        </p>
      </header>
      <KpiCards
        total={d.totalUzs}
        overdue={d.overdueUzs}
        dueWeek={d.dueWeekUzs}
        promisedToday={d.promisedTodayUzs}
      />
      <AgingBar buckets={d.buckets} total={d.totalUzs} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TodayQueue rows={d.queue} />
        </div>
        <div className="space-y-4">
          <TopDebtors rows={d.debtors} />
          {d.usdOverdueMinor > 0n && (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm">
              Plus {formatMoney(d.usdOverdueMinor, 'USD')} overdue — tracked separately, never
              converted.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
