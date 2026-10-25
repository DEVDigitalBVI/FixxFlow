'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { definitionToQuery, type CustomReportDefinition } from './custom-model';
import { fetchReportDownloadUrl } from './download';
import { exportFormats, isExportFormat } from './export-model';

export function CustomReportDownload({
  definition,
  name,
}: {
  definition: CustomReportDefinition;
  name?: string;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null),
    feedback = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current) return;
    const format = new FormData(event.currentTarget).get('format');
    if (typeof format !== 'string' || !isExportFormat(format)) return;
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError('');
    setStatus('Preparing custom report…');
    const query = definitionToQuery(definition);
    query.set('format', format);
    if (name) query.set('name', name);
    try {
      const { blob, filename } = await fetchReportDownloadUrl(
        `/app/reports/export/custom?${query}`,
        format,
        request.signal,
      );
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus('Download started.');
    } catch (cause) {
      if (!request.signal.aborted) {
        setStatus('');
        setError(
          cause instanceof Error ? cause.message : 'The custom report could not be downloaded.',
        );
      }
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }
  return (
    <div className="report-download custom-report-download">
      <form
        action="/app/reports/export/custom"
        method="get"
        onSubmit={download}
        aria-label="Download custom report"
        aria-busy={pending}
      >
        {[...definitionToQuery(definition)].map(([key, value], index) => (
          <input type="hidden" name={key} value={value} key={`${key}-${value}-${index}`} />
        ))}
        {name && <input type="hidden" name="name" value={name} />}
        <label className="field" htmlFor="custom-report-format">
          File format
          <select
            className="input"
            id="custom-report-format"
            name="format"
            defaultValue="xlsx"
            disabled={pending}
          >
            {Object.entries(exportFormats).map(([key, item]) => (
              <option value={key} key={key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-primary" disabled={pending}>
          {pending ? 'Preparing report…' : 'Download report'}
        </button>
      </form>
      <p className="muted" role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <div className="alert alert-error" role="alert" tabIndex={-1} ref={feedback}>
          {error}
        </div>
      )}
    </div>
  );
}
