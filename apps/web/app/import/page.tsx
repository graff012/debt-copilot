import { MAPPING_ROWS, buildImportPreview } from '@/lib/import-preview';
import type { IssueCode, ValidatedRow } from '@debt-copilot/domain';

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

function Exceptions({ rows }: { rows: readonly ValidatedRow[] }) {
  const flagged = rows.filter((r) => r.verdict !== 'valid');
  if (flagged.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Rows needing a decision ({flagged.length})</h2>
      <ul className="mt-3 space-y-2">
        {flagged.map((r) => (
          <li key={r.rowNumber} className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <p className="font-medium">
              Row {r.rowNumber}{' '}
              <span
                className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.verdict === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
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
            <p className="mt-2 text-xs text-slate-400" title="Auto-fix arrives with apps/api review flow">
              Quick-fix actions unlock after human review — nothing auto-applies.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ImportPage() {
  const preview = buildImportPreview();
  const cards = [
    { label: 'Valid records', value: preview.summary.valid, style: 'text-emerald-700' },
    { label: 'Warnings', value: preview.summary.warnings, style: 'text-amber-700' },
    { label: 'Blocked', value: preview.summary.blocked, style: 'text-red-700' },
  ];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Import receivables</h1>
        <p className="text-sm text-slate-500">
          Excel-first preview · demo fixtures validated by @debt-copilot/domain, nothing imported
          yet
        </p>
      </header>

      <div
        aria-disabled="true"
        title="File upload arrives with apps/api"
        className="cursor-not-allowed rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm"
      >
        <p className="font-medium text-slate-400">Drop your .xlsx file here</p>
        <p className="mt-1 text-xs text-slate-400">Upload unlocks with the API import job</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">
          Column mapping <span className="font-normal text-slate-500">7 of 7 confirmed</span>
        </h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4 font-semibold">Excel column</th>
              <th className="py-2 pr-4 font-semibold">System field</th>
              <th className="py-2 font-semibold">Preview</th>
            </tr>
          </thead>
          <tbody>
            {MAPPING_ROWS.map((m) => (
              <tr key={m.source} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4">{m.source}</td>
                <td className="py-2 pr-4 text-slate-600">{m.system}</td>
                <td className="py-2 font-mono text-xs text-slate-600">{m.preview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${c.style}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <Exceptions rows={preview.rows} />

      <div className="flex justify-end gap-2">
        <span
          aria-disabled="true"
          title="Import writes need the API + audit log"
          className="cursor-not-allowed rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-400"
        >
          Cancel
        </span>
        <span
          aria-disabled="true"
          title="Import writes need the API + audit log"
          className="cursor-not-allowed rounded-lg bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700"
        >
          Import {preview.summary.valid} valid records
        </span>
      </div>
    </div>
  );
}
