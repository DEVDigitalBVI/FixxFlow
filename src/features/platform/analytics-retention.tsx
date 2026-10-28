import { RetryButton } from '@/components/ui/retry-button';
import { createClient } from '@/lib/supabase/server';

import { CleanupForm } from './cleanup-form';
import { isRetentionStatus, runSummary } from './retention-model';

const utc = (value: string) => `${value.replace('T', ' ').slice(0, 16)} UTC`;

/** Retention status for the opt-in usage counters, with an audited on-demand run. */
export async function AnalyticsRetention() {
  const db = await createClient();
  const { data, error } = await db.rpc('platform_analytics_retention');
  if (error || !isRetentionStatus(data))
    return (
      <section className="settings-card" aria-label="Data retention">
        <p role="alert">
          Retention status could not load. <RetryButton />
        </p>
      </section>
    );
  const expired = data.expiredKeys + data.expiredCounts;
  return (
    <section
      className="settings-card analytics-retention"
      aria-labelledby="analytics-retention-title"
    >
      <h2 id="analytics-retention-title">Data retention</h2>
      <p className="muted">
        Daily usage counts are kept for {data.retentionDays} days. Expired analytics records are
        cleared automatically each day.
      </p>
      <dl className="asset-facts">
        <dt>Last cleanup</dt>
        <dd>
          {data.lastRun ? (
            <>
              <time dateTime={data.lastRun.startedAt}>{utc(data.lastRun.startedAt)}</time> ·{' '}
              {runSummary(data.lastRun)}
            </>
          ) : (
            'No cleanup has run yet.'
          )}
        </dd>
        <dt>Waiting for cleanup</dt>
        <dd>
          {expired
            ? `${data.expiredKeys.toLocaleString('en')} expired keys · ${data.expiredCounts.toLocaleString('en')} daily counts past retention`
            : 'Nothing expired.'}
        </dd>
      </dl>
      <details>
        <summary>Retention details</summary>
        <p className="muted">
          Daily counts use UTC dates. Temporary tracking keys expire after one day, or 90 days for
          logins. Scheduled cleanup runs at 03:17 UTC and appears under Last cleanup. Runs started
          here are also recorded in the platform audit log.
        </p>
      </details>
      <CleanupForm />
    </section>
  );
}
