'use client';

import { useRef, useState } from 'react';
import { MAX_FILE_BYTES, detectCurrency, sheetToInputs } from '@/lib/excel';
import { previewRows, type ImportPreview } from '@/lib/import-preview';
import { ImportResults } from './ImportResults';

type UploadState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'error'; message: string }
  | { status: 'done'; fileName: string; currency: string; preview: ImportPreview };

async function parseFile(file: File): Promise<Omit<Extract<UploadState, { status: 'done' }>, 'status'>> {
  if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than the 50 MB limit.');
  const buffer = await file.arrayBuffer();
  // Lazy: the xlsx parser (~120 kB) loads only when a file is actually chosen.
  const { read, utils } = await import('xlsx');
  const workbook = read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('No sheets found in this file.');
  const worksheet = workbook.Sheets[firstSheet];
  if (!worksheet) throw new Error('The first sheet is empty.');
  const grid = utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null }) as unknown[][];
  const currency = detectCurrency(grid[0] ?? []);
  const inputs = sheetToInputs(grid, currency);
  if (inputs.length === 0) throw new Error('No data rows found — only headers?');
  return { fileName: file.name, currency, preview: previewRows(inputs) };
}

export function UploadZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<UploadState>({ status: 'idle' });

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setState({ status: 'reading' });
    parseFile(file).then(
      (done) => setState({ status: 'done', ...done }),
      (err: unknown) =>
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Could not read file.' }),
    );
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border border-dashed bg-white p-8 text-center shadow-sm ${
          dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'
        }`}
      >
        <p className="font-medium text-slate-700">Drop your .xlsx file here, or</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {state.status === 'reading' ? 'Reading…' : 'Upload from device'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="mt-3 text-xs text-slate-400">
          Parsed locally on your device — nothing is uploaded anywhere.
        </p>
      </div>

      {state.status === 'error' && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {state.message}
        </p>
      )}

      {state.status === 'done' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">{state.fileName}</span> · detected currency{' '}
            {state.currency} · {state.preview.rows.length} rows checked
          </p>
          <ImportResults rows={state.preview.rows} summary={state.preview.summary} />
        </div>
      )}
    </div>
  );
}
