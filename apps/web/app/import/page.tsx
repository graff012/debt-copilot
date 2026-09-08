import { MAPPING_ROWS, buildImportPreview } from '@/lib/import-preview';
import { ImportResults } from '@/components/ImportResults';
import { UploadZone } from '@/components/UploadZone';

export default function ImportPage() {
  const preview = buildImportPreview();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Import receivables</h1>
        <p className="text-sm text-slate-500">
          Excel-first preview · demo fixtures validated by @debt-copilot/domain, nothing imported
          yet
        </p>
      </header>

      <UploadZone />

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

      <ImportResults rows={preview.rows} summary={preview.summary} />

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
