import type { QueueStatus } from '@/lib/dashboard';

const STYLES: Record<QueueStatus, string> = {
  broken: 'bg-red-100 text-red-800',
  'promise-today': 'bg-violet-100 text-violet-800',
  overdue: 'bg-red-50 text-red-700',
  current: 'bg-emerald-100 text-emerald-800',
};

const LABELS: Record<QueueStatus, string> = {
  broken: 'Broken promise',
  'promise-today': 'Promise due today',
  overdue: 'Overdue',
  current: 'On track',
};

export function StatusBadge({ status, detail }: { status: QueueStatus; detail?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {detail ?? LABELS[status]}
    </span>
  );
}
