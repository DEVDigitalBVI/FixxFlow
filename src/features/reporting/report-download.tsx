'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { exportFormats, isExportFormat } from './export-model';
import { fetchReportDownload } from './download';

export function ReportDownload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current) return;
    const format = new FormData(event.currentTarget).get('format');
    if (typeof format !== 'string' || !isExportFormat(format)) return;
    const request = new AbortController();
    controller.current = request;
    setError(''); setStatus('Preparing report…'); setPending(true);
    try {
      const { blob, filename } = await fetchReportDownload(format, request.signal);
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      // Allow the browser to finish handing the blob to its download manager.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus('Download started.');
    } catch (cause) {
      if (request.signal.aborted) return;
      setStatus('');
      setError(cause instanceof Error && cause.message !== 'Failed to fetch' ? cause.message : 'Unable to download. Check your connection and try again.');
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setPending(false);
    }
  }
  return <div className="report-download">
    <form action="/app/reports/export" method="get" onSubmit={download} aria-label="Download report" aria-busy={pending}>
      <div className="field"><label htmlFor="report-format">File format</label><select className="input" id="report-format" name="format" defaultValue="xlsx" disabled={pending} aria-describedby="report-download-hint">{Object.entries(exportFormats).map(([format, { label }]) => <option key={format} value={format}>{label}</option>)}</select></div>
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Preparing report…' : 'Download report'}</button>
    </form>
    <p className="muted" id="report-download-hint">Includes summary, all 30 days, SLA, and breakdowns. Downloads refresh the data.</p>
    <p className="muted" role="status" aria-live="polite">{status}</p>
    {error && <div className="alert alert-error" role="alert" tabIndex={-1} ref={feedback}><p>{error}</p><a className="button button-secondary" href="/app/reports">Reload Reports</a></div>}
  </div>;
}
