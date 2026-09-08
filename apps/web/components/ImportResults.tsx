import type { ImportSummary, IssueCode, ValidatedRow } from '@debt-copilot/domain';

const ISSUE_HELP: Record<IssueCode, string> = {
  MISSING_CUSTOMER: 'Customer name is empty — blocked.',
  MISSING_INVOICE: 'Invoice number is empty — blocked.',
  INVALID_AMOUNT: 'Amount is not a valid number — blocked. Fix the cell, do not guess.',
  INVALID_DUE_DATE: 'Due date is not YYYY-MM-DD — blocked.',
  INVALID_INVOICE_DATE: 'Invoice date is not YYYY-MM-DD — blocked.',
  MISSING_DUE_DATE: 'No due date — Net-15 fallback applied, confirm it.',
  MISSING_BOTH_DATES: 'No usable date — blocked.',
  SHORT_TIN: 'TIN must be 9 digits — needs manual review.',
  UNMATCHED_CUSTOMER: 'No TIN or external id — cannot auto-match, needs review.',
  DUPLICATE_IN_FILE: 'Same key twice in this file — both blocked, keep one.',
};

export function ImportResults({
  rows,
  summary,
}: {
  rows: readonly ValidatedRow[];
  summary: ImportSummary;
}) {
  const flagged = rows.filter((r) => r.verdict !== 'valid');
  const cards = [
    { label: 'Valid records', value: summary.valid, style: 'text-emerald-700' },
    { label: 'Warnings', value: summary.warnings, style: 'text-amber-700' },
    { label: 'Blocked', value: summary.blocked, style: 'text-red-700' },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${c.style}`}>{c.value}</p>
          </div>
        ))}
      </div>
      {flagged.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Rows needing a decision ({flagged.length})</h2>
          <ul className="mt-3 space-y-2">
            {flagged.map((r) => (
              <li key={r.rowNumber} className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <p className="font-medium">
                  Row {r.rowNumber}{' '}
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.verdict === 'blocked'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.verdict}
                  </span>
                </p>
                <ul className="mt-1 list-disc pl-5 text-slate-600">
                  {r.issues.map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>{ISSUE_HELP[issue.code]}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-400">
                  Quick-fix actions unlock after human review — nothing auto-applies.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
