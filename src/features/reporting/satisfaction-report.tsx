import Link from 'next/link';

import { RetryButton } from '@/components/ui/retry-button';
import { isSatisfactionSummary, ratingLabel, satisfiedPercent } from '@/features/tickets/ratings';
import { Timestamp } from '@/features/timezones/provider';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

/** Employee resolution ratings over the last 30 days. Staff only (enforced by the RPC). */
export async function SatisfactionReport({ organizationId }: { organizationId: string }) {
  const db = await createClient();
  const { data, error } = await db.rpc('satisfaction_summary', {
    target_organization_id: organizationId,
    days: 30,
  });
  if (error || !isSatisfactionSummary(data)) {
    if (error) reportServerError('report.satisfaction', error);
    return (
      <section className="settings-card" aria-label="Resolution satisfaction">
        <p role="alert">
          Satisfaction ratings could not load. <RetryButton />
        </p>
      </section>
    );
  }
  const percent = satisfiedPercent(data);
  const average = data.average === null ? null : Number(data.average);
  return (
    <section
      className="settings-card report-satisfaction"
      aria-labelledby="report-satisfaction-title"
    >
      <header className="overview-section-heading">
        <div>
          <h2 id="report-satisfaction-title">Resolution satisfaction</h2>
          <p>How do employees rate the way their requests were resolved? Last {data.days} days.</p>
        </div>
      </header>
      {data.responses ? (
        <>
          <dl className="report-metrics">
            <div className="settings-card">
              <dt>Satisfied</dt>
              <dd>
                <span>{percent}%</span>
                <p>
                  {data.satisfied} of {data.responses} rated 4 or 5
                </p>
              </dd>
            </div>
            <div className="settings-card">
              <dt>Average rating</dt>
              <dd>
                <span>{average?.toFixed(1)} of 5</span>
                <p>1 is very dissatisfied, 5 is very satisfied</p>
              </dd>
            </div>
            <div className="settings-card">
              <dt>Ratings received</dt>
              <dd>
                <span>{data.responses}</span>
                <p>First submitted in this period</p>
              </dd>
            </div>
          </dl>
          <div className="report-satisfaction-grid">
            <div>
              <h3>Ratings by score</h3>
              <ul className="report-bars">
                {data.distribution.map((row) => (
                  <li key={row.score}>
                    <div>
                      <span>
                        {row.score} · {ratingLabel(row.score)}
                      </span>
                      <strong>{row.count}</strong>
                    </div>
                    <span className="report-bar-track" aria-hidden="true">
                      <span style={{ width: `${(row.count / data.responses) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Latest comments</h3>
              {data.comments.length ? (
                <ul className="report-satisfaction-comments">
                  {data.comments.map((item) => (
                    <li key={`${item.ticket_id}:${item.updated_at}`}>
                      <p>“{item.comment}”</p>
                      <small>
                        {ratingLabel(item.score)} ·{' '}
                        <Link href={`/app/tickets/${item.ticket_id}`}>
                          #{item.ticket_number} {item.title}
                        </Link>{' '}
                        · <Timestamp value={item.updated_at} />
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No written comments in this period.</p>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="report-empty">
          <strong>No ratings yet</strong>
          <p>
            Scores appear after employees rate resolved requests. Ratings stay open for 30 days
            after resolution. No ratings does not mean low satisfaction.
          </p>
        </div>
      )}
    </section>
  );
}
