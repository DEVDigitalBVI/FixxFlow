'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { importAssets } from '@/app/app/assets/import/actions';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TableRegion } from '@/components/ui/table';

import {
  FILE_LIMIT,
  importColumns,
  importKindAliases,
  type ImportResult,
  type ImportRow,
} from './import-model';
import { assetKinds, assetStatuses } from './model';

type Parsed = ImportResult & { sheet?: string; sheets?: string[] };
const labels = {
  tag: 'Asset tag',
  name: 'Name',
  kind: 'Type',
  status: 'Lifecycle',
  serial_number: 'Serial number',
  model: 'Model',
  assigned_email: 'Employee email',
  location: 'Location',
  purchased_on: 'Purchase date',
  warranty_until: 'Warranty ends',
  end_of_life_on: 'End of life',
};
export function AssetImport() {
  const [updateExisting, setUpdateExisting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(1);
  const worker = useRef<Worker | null>(null);
  const lock = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (result.error || result.success || result.rows) feedback.current?.focus();
  }, [result]);
  async function preview() {
    if (lock.current || !file) return;
    lock.current = true;
    setBusy(true);
    setReady(false);
    setResult({});
    setPage(1);
    try {
      if (file.size > FILE_LIMIT) throw Error('Choose a file smaller than 2 MB.');
      const buffer = await file.arrayBuffer();
      const parsed = await new Promise<Parsed>((resolve, reject) => {
        const w = new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' });
        worker.current = w;
        const finish = () => {
          clearTimeout(timer);
          w.terminate();
          worker.current = null;
        };
        const timer = setTimeout(() => {
          finish();
          reject(
            Error(
              'This file is taking too long to read. Save a smaller CSV or Excel file and try again.',
            ),
          );
        }, 15000);
        w.onmessage = (event) => {
          finish();
          resolve(event.data);
        };
        w.onerror = () => {
          finish();
          reject(
            Error('The file could not be read. Save a fresh CSV or Excel file and try again.'),
          );
        };
        w.postMessage({ buffer, filename: file.name, sheet: sheet || undefined }, [buffer]);
      });
      if (parsed.sheets) setSheets(parsed.sheets);
      if (parsed.sheet) setSheet(parsed.sheet);
      if (parsed.error || parsed.issues?.length || !parsed.rows) {
        setResult(parsed);
        return;
      }
      const checked = await importAssets(parsed.rows, 'preview', { updateExisting });
      setResult(checked);
      setReady(!checked.error && !checked.issues?.length && !!checked.rows?.length);
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : 'Preview could not finish. Try again.',
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (lock.current || !ready || !result.rows) return;
    lock.current = true;
    setBusy(true);
    try {
      const saved = await importAssets(result.rows, 'save', {
        updateExisting,
        versions: result.versions,
      });
      setResult(saved.error ? { ...result, ...saved } : saved);
      setReady(false);
    } catch {
      setResult({
        ...result,
        error:
          'The import result could not be confirmed. Check inventory before retrying; unique asset tags prevent duplicates.',
      });
      setReady(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const rows = result.rows ?? [];
  const issues = result.issues ?? [];
  const pages = Math.ceil(rows.length / 25);
  const updates = updateExisting ? Object.keys(result.versions ?? {}).length : 0;
  return (
    <div className="stack asset-import">
      <section className="settings-card stack" aria-labelledby="import-file-heading">
        <div>
          <h2 id="import-file-heading">1. Choose your spreadsheet</h2>
          <p className="muted">
            CSV, XLSX, or XLS · Up to 500 rows · Maximum 2 MB. Only the selected worksheet is
            imported.
          </p>
        </div>
        <label>
          <Checkbox
            checked={updateExisting}
            disabled={busy || !!result.success}
            onChange={(event) => {
              setUpdateExisting(event.target.checked);
              setReady(false);
              setResult({});
            }}
          />{' '}
          Create or update by asset tag
        </label>
        {updateExisting && (
          <p className="form-note">
            Matching tags will be updated. Blank optional cells clear saved values; omitted columns
            are treated as blank. Include every field you want to keep.
          </p>
        )}
        <div className="page-header-actions">
          <a
            className={buttonVariants({ variant: 'secondary' })}
            download="fixxflow-assets-template.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(importColumns.join(',') + '\r\n')}`}
          >
            Download CSV template
          </a>
          <span className="muted">
            The template opens in Excel. Keep identifiers such as tags and serial numbers formatted
            as text.
          </span>
        </div>
        <details>
          <summary>Column guide</summary>
          <dl className="asset-import-guide">
            <div>
              <dt>Required: tag, name</dt>
              <dd>
                Use a unique tag (up to 60 characters) and a name (2–160 characters). Tags are
                converted to uppercase.
              </dd>
            </div>
            <div>
              <dt>kind, status</dt>
              <dd>
                Types: {Object.values(assetKinds).join(', ')}.{' '}
                {Object.keys(importKindAliases).join(', ')} import as Computer. Lifecycle:{' '}
                {Object.values(assetStatuses).join(', ')}. Blank values default to Computer and
                Available. Type and lifecycle values are not case-sensitive; values such as “in_use”
                also work.
              </dd>
            </div>
            <div>
              <dt>serial_number, model</dt>
              <dd>Optional. Serial numbers allow 120 characters, models 160.</dd>
            </div>
            <div>
              <dt>assigned_email, location</dt>
              <dd>
                Optional. Use an active employee’s exact email and an active location’s exact name.
                Leave blank for unassigned equipment or no location. Retired assets must be
                unassigned.
              </dd>
            </div>
            <div>
              <dt>purchased_on, warranty_until, end_of_life_on</dt>
              <dd>
                Optional. Use YYYY-MM-DD or Excel date cells. Warranty and end-of-life dates cannot
                be before purchase. Paste formulas as values and remove merged cells.
              </dd>
            </div>
          </dl>
        </details>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void preview();
          }}
        >
          <label className="field">
            Asset spreadsheet
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              required
              disabled={busy || !!result.success}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setSheet('');
                setSheets([]);
                setResult({});
                setReady(false);
              }}
            />
          </label>
          {sheets.length > 1 && (
            <label className="field">
              Worksheet
              <NativeSelect
                value={sheet}
                disabled={busy || !!result.success}
                onChange={(event) => {
                  setSheet(event.target.value);
                  setResult({});
                  setReady(false);
                }}
              >
                {sheets.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </NativeSelect>
            </label>
          )}
          <div>
            <Button
              variant="secondary"
              type="submit"
              disabled={busy || !file || !!result.success}
              aria-busy={busy}
            >
              {busy ? 'Processing…' : 'Preview and validate'}
            </Button>
          </div>
        </form>
      </section>
      {(result.error || result.success || rows.length > 0) && (
        <Alert
          ref={feedback}
          tabIndex={-1}
          tone={result.error || issues.length ? 'error' : result.success ? 'success' : 'neutral'}
          role={result.error || issues.length ? 'alert' : 'status'}
        >
          {result.error ??
            result.success ??
            (issues.length
              ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found. Fix your spreadsheet, choose the updated file, and preview again. Nothing has been imported.`
              : `Ready to save: ${rows.length - updates} to create, ${updates} to update.`)}
        </Alert>
      )}
      {issues.length > 0 && (
        <section className="settings-card" aria-labelledby="import-issues-heading">
          <h2 id="import-issues-heading">Rows to fix</h2>
          <ul className="asset-import-issues" tabIndex={0} aria-label="Spreadsheet row errors">
            {issues.map((issue, i) => (
              <li key={i}>
                <strong>Row {issue.row}:</strong> {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {rows.length > 0 && (
        <section className="stack" aria-labelledby="import-preview-heading">
          <div>
            <h2 id="import-preview-heading">2. Review assets</h2>
            <p className="muted">Review each row. The entire batch saves together.</p>
          </div>
          <TableRegion role="region" aria-label="Asset import preview" tabIndex={0}>
            <Table className="responsive-table asset-import-table">
              <caption>
                {file?.name} · {sheet}
                {pages > 1 && (
                  <>
                    {' '}
                    · Page {page} of {pages}
                  </>
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Change</th>
                  {importColumns.map((k) => (
                    <th scope="col" key={k}>
                      {labels[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * 25, page * 25).map((row: ImportRow) => (
                  <tr key={row.row}>
                    <td data-label="Row">Row {row.row}</td>
                    <td data-label="Change">
                      {result.versions?.[row.tag]
                        ? updateExisting
                          ? 'Update'
                          : 'Tag exists'
                        : 'Create'}
                    </td>
                    {importColumns.map((k) => (
                      <td data-label={labels[k]} key={k}>
                        {k === 'kind'
                          ? (assetKinds[row.kind as keyof typeof assetKinds] ?? row.kind)
                          : k === 'status'
                            ? (assetStatuses[row.status as keyof typeof assetStatuses] ??
                              row.status)
                            : row[k] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableRegion>
          {pages > 1 && (
            <nav className="page-header-actions" aria-label="Preview pages">
              <Button
                type="button"
                variant="secondary"
                disabled={page === 1 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span role="status">
                Page {page} of {pages}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={page === pages || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </nav>
          )}
          <div>
            <Button
              variant="primary"
              type="button"
              disabled={!ready || busy}
              aria-busy={busy}
              onClick={() => void save()}
            >
              {busy
                ? 'Saving…'
                : updateExisting
                  ? 'Save reviewed changes'
                  : `Import ${rows.length} asset${rows.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </section>
      )}
      {result.success && (
        <Link className={buttonVariants({ variant: 'primary' })} href="/app/assets">
          View asset inventory
        </Link>
      )}
    </div>
  );
}
