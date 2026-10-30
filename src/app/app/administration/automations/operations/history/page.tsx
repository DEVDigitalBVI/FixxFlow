import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import {
  automationOperationsHistory,
  type OperationsFilters,
} from '@/features/automation/operations-service';
import { OperationsHistoryTable, operationsPath } from '@/features/automation/operations-view';
import { AutomationHeader } from '@/features/automation/page-parts';
import { triggerOptions } from '@/features/automation/ui-model';

export default async function OperationsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<OperationsFilters>;
}) {
  const input = await searchParams,
    data = await automationOperationsHistory(input),
    f = data.filters,
    base = `${operationsPath}/history`;
  const filterParams = new URLSearchParams({
    q: f.query,
    trigger: f.trigger,
    result: f.result,
    from: f.from,
    to: f.to,
    ticket: f.ticket,
  });
  const last = data.rows.at(-1);
  const next = new URLSearchParams(filterParams);
  if (last) {
    next.set('before', last.started_at);
    next.set('cursor', last.id);
    if (data.since) next.set('since', data.since);
    if (data.until) next.set('until', data.until);
  }
  return (
    <>
      <AutomationHeader
        title="Automation execution history"
        description="Your organization’s executions, with the immutable version used for each run."
        back={operationsPath}
        backLabel="Automation Operations"
      />
      <form action={base} className="settings-card stack" aria-label="Filter execution history">
        <div className="automation-operations-grid">
          <div className="field">
            <label htmlFor="operations-query">Automation name</label>
            <Input
              id="operations-query"
              type="search"
              name="q"
              maxLength={120}
              defaultValue={f.query}
            />
          </div>
          <div className="field">
            <label htmlFor="operations-result">Result</label>
            <NativeSelect id="operations-result" name="result" defaultValue={f.result}>
              {Object.entries({
                all: 'All results',
                failures: 'All failures',
                succeeded: 'Completed',
                skipped: 'Conditions not met',
                running: 'In progress',
                action_failed: 'Action failed',
                guardrail: 'Safety limit reached',
                retry_exhausted: 'Retry exhausted',
                delivery_failed: 'Delivery failed',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="field">
            <label htmlFor="operations-trigger">Trigger</label>
            <NativeSelect id="operations-trigger" name="trigger" defaultValue={f.trigger}>
              <option value="">All triggers</option>
              {triggerOptions.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="field">
            <label htmlFor="operations-ticket">Ticket number</label>
            <Input
              id="operations-ticket"
              name="ticket"
              type="number"
              min={1}
              defaultValue={f.ticket}
            />
          </div>
          <div className="field">
            <label htmlFor="operations-from">From date (UTC)</label>
            <Input
              id="operations-from"
              name="from"
              type="date"
              defaultValue={f.from}
              aria-describedby="operations-range-help"
            />
          </div>
          <div className="field">
            <label htmlFor="operations-to">Through date (UTC)</label>
            <Input
              id="operations-to"
              name="to"
              type="date"
              defaultValue={f.to}
              aria-describedby="operations-range-help"
            />
          </div>
        </div>
        <p id="operations-range-help" className="muted">
          Defaults to the last 24 hours. Select a range of up to 31 days. Names reflect the version
          that executed.
        </p>
        {data.error && (
          <Alert as="p" tone="error" role="alert">
            {data.error}
          </Alert>
        )}
        <div className="automation-inline">
          <Button variant="secondary" type="submit">
            Filter history
          </Button>
          <Link className={buttonVariants({ variant: 'quiet' })} href={base}>
            Clear filters
          </Link>
        </div>
      </form>
      {data.rows.length ? (
        <OperationsHistoryTable rows={data.rows} />
      ) : (
        <section className="settings-card">
          <h2>
            {f.result === 'failures'
              ? 'No failures match these filters'
              : 'No executions match these filters'}
          </h2>
          <p>Choose another date range or clear the filters. Tests do not create executions.</p>
        </section>
      )}
      {(f.beforeId || (data.hasNext && last)) && (
        <nav className="queue-views" aria-label="Execution history pages">
          {f.beforeId && (
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href={`${base}?${filterParams}`}
            >
              Newest results
            </Link>
          )}
          {data.hasNext && last && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={`${base}?${next}`}>
              Older results
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
