import Link from 'next/link';
import { automationPath } from './ui-model';

export function AutomationListEmptyState({ filtered, title, description }: { filtered: boolean; title: string; description: string }) {
  if (filtered) return <div className="automation-list-no-results">
    <h3>{title}</h3><p>{description}</p>
    <Link className="button button-secondary" href={automationPath}>Clear filters</Link>
  </div>;

  return <div className="automation-list-welcome">
    <div className="automation-list-welcome-copy">
      <span className="administration-card-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/></svg></span>
      <h3>{title}</h3>
      <p>{description}</p>
      <Link className="button button-primary" href={`${automationPath}/new`}>Create Automation</Link>
      <p className="automation-list-welcome-note">Start with a template or build your own. Save a disabled draft and test it before enabling.</p>
    </div>
    <section className="automation-workflow-example" aria-labelledby="automation-example-heading">
      <header><span className="badge badge-inactive">Example workflow</span><h3 id="automation-example-heading">A head start on critical tickets</h3></header>
      <ol>
        <li><span className="automation-example-step" aria-hidden="true">1</span><div><strong>When</strong><span>A ticket is created</span></div></li>
        <li><span className="automation-example-step" aria-hidden="true">2</span><div><strong>If</strong><span>Priority is Critical</span></div></li>
        <li><span className="automation-example-step" aria-hidden="true">3</span><div><strong>Then</strong><span>Add an internal triage note</span></div></li>
      </ol>
      <p>An example to get you started. No rule has been created.</p>
    </section>
  </div>;
}
