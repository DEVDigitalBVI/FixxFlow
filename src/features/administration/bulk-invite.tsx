'use client';

import { useRef, useState } from 'react';

import { sendInvitationBatch } from '@/app/app/people/import/actions';
import { useUnsavedChanges } from '@/components/ui/unsaved-changes';

import type { BulkInviteRow } from './bulk-invite-model';

type Row = BulkInviteRow & { status: 'pending' | 'sent' | 'failed' | 'skipped'; message?: string };
const roles = { end_user: 'Employee', technician: 'Technician', administrator: 'Administrator' };
export function BulkInvite() {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const uploadVersion = useRef(0);
  const stop = useRef(false),
    lock = useRef(false),
    feedback = useRef<HTMLDivElement>(null);
  useUnsavedChanges(rows.some((row) => row.status === 'pending' || row.status === 'failed'));
  async function choose(file: File | undefined) {
    if (!file) return;
    const version = ++uploadVersion.current;
    setError('');
    setReading(true);
    try {
      if (file.size > 200_000 || !/\.csv$/i.test(file.name))
        throw Error('Choose a CSV file smaller than 200 KB.');
      const { parseInvitationCsv } = await import('./bulk-invite-parser');
      const parsed = parseInvitationCsv(await file.arrayBuffer(), file.name);
      if (version !== uploadVersion.current) return;
      setRows(parsed.map((row) => ({ ...row, token: crypto.randomUUID(), status: 'pending' })));
    } catch (error) {
      if (version !== uploadVersion.current) return;
      setError(error instanceof Error ? error.message : 'The CSV could not be read.');
      setRows([]);
      feedback.current?.focus();
    } finally {
      if (version === uploadVersion.current) setReading(false);
    }
  }
  async function send() {
    if (lock.current) return;
    lock.current = true;
    stop.current = false;
    setBusy(true);
    setError('');
    const remaining = rows.filter((row) => row.status === 'pending' || row.status === 'failed');
    try {
      for (let index = 0; index < remaining.length && !stop.current; index += 5) {
        const batch = remaining.slice(index, index + 5);
        const result = await sendInvitationBatch(
          batch.map(({ email, displayName, role, token }) => ({ email, displayName, role, token })),
        );
        if (result.error || !result.rows) {
          setError(
            result.error ?? 'Invitations could not be confirmed. Retry without reloading this CSV.',
          );
          break;
        }
        const outcomes = new Map(result.rows.map((row) => [row.token, row]));
        setRows((previous) =>
          previous.map((row) => {
            const outcome = outcomes.get(row.token);
            return outcome
              ? {
                  ...row,
                  status: outcome.success ? 'sent' : 'failed',
                  message: outcome.success ?? outcome.error,
                }
              : row;
          }),
        );
        if (result.rows.some((row) => row.error)) {
          setError(
            'Some invitations need attention. Retry them, or skip those rows before continuing.',
          );
          break;
        }
      }
    } catch {
      setError(
        'The last group could not be confirmed. Retry without reloading this CSV; existing invitations will be recovered.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
      feedback.current?.focus();
    }
  }
  const pending = rows.filter((row) => row.status === 'pending' || row.status === 'failed').length;
  return (
    <div className="stack">
      <div ref={feedback} tabIndex={-1}>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!rows.length && (
        <section className="settings-card stack">
          <label className="field">
            CSV file
            <input
              className="input"
              type="file"
              accept=".csv,text/csv"
              disabled={busy || reading}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
          <p className="muted">
            Use Email, Name and optional Role columns. Blank roles become Employee. Up to 100
            people.
          </p>
          <a
            className="button button-secondary"
            download="fixxflow-invitations.csv"
            href="data:text/csv;charset=utf-8,Email%2CName%2CRole%0Ajordan%40example.com%2CJordan%20Smith%2CEmployee%0A"
          >
            Download example CSV
          </a>
          {reading && <p role="status">Reading CSV…</p>}
        </section>
      )}
      {rows.length > 0 && (
        <>
          <p role="status">
            {rows.filter((row) => row.status === 'sent').length} of {rows.length} invitations
            completed.{' '}
            {rows.filter((row) => row.role === 'administrator').length > 0
              ? `${rows.filter((row) => row.role === 'administrator').length} Administrator invitation${rows.filter((row) => row.role === 'administrator').length === 1 ? '' : 's'}.`
              : ''}
          </p>
          <div className="table-scroll">
            <table className="table responsive-table table-policy">
              <caption>Review invitations before sending</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.token}>
                    <td data-label="Name">{row.displayName}</td>
                    <td data-label="Email">{row.email}</td>
                    <td data-label="Role">{roles[row.role]}</td>
                    <td data-label="Result">
                      {row.message ??
                        (row.status === 'pending'
                          ? 'Ready to invite'
                          : row.status === 'skipped'
                            ? 'Skipped'
                            : 'Needs retry')}
                      {row.status === 'failed' && !busy && (
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() =>
                            setRows((previous) =>
                              previous.map((item) =>
                                item.token === row.token
                                  ? { ...item, status: 'skipped', message: 'Skipped' }
                                  : item,
                              ),
                            )
                          }
                        >
                          Skip {row.displayName}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="page-header-actions">
            <button
              className="button button-primary"
              disabled={busy || pending === 0}
              onClick={() => void send()}
            >
              {busy
                ? 'Sending invitations…'
                : `Send ${pending} remaining invitation${pending === 1 ? '' : 's'}`}
            </button>
            {busy ? (
              <button
                className="button button-secondary"
                onClick={() => {
                  stop.current = true;
                }}
              >
                Stop after this group
              </button>
            ) : (
              <button
                className="button button-secondary"
                onClick={() => {
                  setRows([]);
                  setError('');
                }}
              >
                Choose another CSV
              </button>
            )}
          </div>
          <p className="muted">
            Only reviewed invitations are sent. Existing accounts are never moved to another
            workspace, and retries keep the same invitation keys.
          </p>
        </>
      )}
    </div>
  );
}
