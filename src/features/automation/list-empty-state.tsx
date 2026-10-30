import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

import { automationPath } from './ui-model';

export function AutomationListEmptyState({
  filtered,
  title,
  description,
}: {
  filtered: boolean;
  title: string;
  description: string;
}) {
  if (filtered)
    return (
      <div className="automation-list-no-results">
        <h3>{title}</h3>
        <p>{description}</p>
        <Link className={buttonVariants({ variant: 'secondary' })} href={automationPath}>
          Clear filters
        </Link>
      </div>
    );

  return (
    <div className="automation-list-welcome">
      <div className="automation-list-welcome-copy">
        <span className="administration-card-icon">
          <NavigationIcon name="automation" />
        </span>
        <h3>{title}</h3>
        <p>{description}</p>
        <Link className={buttonVariants({ variant: 'primary' })} href={`${automationPath}/new`}>
          Create Automation
        </Link>
        <p className="automation-list-welcome-note">
          Start with a template or build your own. Save a disabled draft and test it before
          enabling.
        </p>
      </div>
      <section className="automation-workflow-example" aria-labelledby="automation-example-heading">
        <header>
          <Badge tone="muted">Example workflow</Badge>
          <h3 id="automation-example-heading">A head start on urgent tickets</h3>
        </header>
        <ol>
          <li>
            <span className="automation-example-step" aria-hidden="true">
              1
            </span>
            <div>
              <strong>When</strong>
              <span>A ticket is created</span>
            </div>
          </li>
          <li>
            <span className="automation-example-step" aria-hidden="true">
              2
            </span>
            <div>
              <strong>If</strong>
              <span>Priority is Urgent</span>
            </div>
          </li>
          <li>
            <span className="automation-example-step" aria-hidden="true">
              3
            </span>
            <div>
              <strong>Then</strong>
              <span>Add an internal triage note</span>
            </div>
          </li>
        </ol>
        <p>An example to get you started. No rule has been created.</p>
      </section>
    </div>
  );
}
