import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  automationOperations,
  automationOperationsHistory,
} from '@/features/automation/operations-service';
import {
  OperationsHistoryTable,
  OperationsOverviewView,
  operationsPath,
} from '@/features/automation/operations-view';
import { AutomationHeader } from '@/features/automation/page-parts';

export default async function OperationsPage() {
  const [data, failures] = await Promise.all([
    automationOperations(),
    automationOperationsHistory({ result: 'failures' }),
  ]);
  return (
    <>
      <AutomationHeader
        title="Automation Operations"
        description="Service availability, your organization’s work queue and recent execution outcomes."
      />
      <div className="automation-inline">
        <form action={operationsPath}>
          <Button variant="secondary" type="submit">
            Refresh status
          </Button>
        </form>
        <Link
          className={buttonVariants({ variant: 'secondary' })}
          href={`${operationsPath}/history`}
        >
          Execution history
        </Link>
      </div>
      <OperationsOverviewView data={data} />
      <section className="settings-card stack">
        <h2>Recent failures</h2>
        {failures.rows.length ? (
          <OperationsHistoryTable rows={failures.rows.slice(0, 5)} />
        ) : (
          <p>No execution failures in the last 24 hours.</p>
        )}
        <Link
          className={buttonVariants({ variant: 'secondary' })}
          href={`${operationsPath}/history?result=failures`}
        >
          View failure history
        </Link>
        <p className="muted">
          Delivery failures without an execution appear in the queue summary. Use execution details
          to find safe log correlation identifiers.
        </p>
      </section>
    </>
  );
}
