'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';

import { fetchReportDownloadUrl } from './download';
import { exportFormats, isExportFormat } from './export-model';

/** Format picker plus a fetched download with announced progress and recoverable errors. */
export function ReportDownload({
  action = '/app/reports/export',
  params = {},
  hint = 'Includes summary, all 30 days, SLA, and breakdowns. Downloads refresh the data.',
  label = 'Download report',
  pendingLabel = 'Preparing report…',
  reload = { href: '/app/reports', label: 'Reload Reports' },
}: {
  action?: string;
  /** Extra query parameters sent with the chosen format, such as a search term. */
  params?: Record<string, string>;
  hint?: string;
  label?: string;
  pendingLabel?: string;
  reload?: { href: string; label: string };
} = {}) {
  const id = useId();
  const formatId = `${id}-format`,
    hintId = `${id}-hint`;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
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
    setError('');
    setStatus(pendingLabel);
    setPending(true);
    try {
      const query = new URLSearchParams({ ...params, format });
      const { blob, filename } = await fetchReportDownloadUrl(
        `${action}?${query}`,
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
      // Allow the browser to finish handing the blob to its download manager.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus('Download started.');
    } catch (cause) {
      if (request.signal.aborted) return;
      setStatus('');
      setError(
        cause instanceof Error && cause.message !== 'Failed to fetch'
          ? cause.message
          : 'Unable to download. Check your connection and try again.',
      );
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }
  return (
    <div className="report-download">
      <form action={action} method="get" onSubmit={download} aria-label={label} aria-busy={pending}>
        {Object.entries(params).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="field">
          <label htmlFor={formatId}>File format</label>
          <NativeSelect
            id={formatId}
            name="format"
            defaultValue="xlsx"
            disabled={pending}
            aria-describedby={hintId}
          >
            {Object.entries(exportFormats).map(([format, { label }]) => (
              <option key={format} value={format}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? pendingLabel : label}
        </Button>
      </form>
      <p className="muted" id={hintId}>
        {hint}
      </p>
      <p className="muted" role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <Alert tone="error" role="alert" tabIndex={-1} ref={feedback}>
          <p>{error}</p>
          <a className={buttonVariants({ variant: 'secondary' })} href={reload.href}>
            {reload.label}
          </a>
        </Alert>
      )}
    </div>
  );
}
