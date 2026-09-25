import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { administrationSections } from '@/features/administration/sections';

export default async function AdministrationPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const policies = administrationSections.filter(item => ['teams', 'categories', 'slas', 'notifications', 'security', 'audit-log'].includes(item.slug));
  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">{viewer.organizationName}</span><h1>Administration</h1><p>Manage your organization, people, and support content.</p></div></header>
    <section className="administration-group" aria-labelledby="manage-heading"><h2 id="manage-heading">Manage your workspace</h2><div className="settings-grid">
      <article className="settings-card"><h3>Organization</h3><p>Keep your workspace details, departments, and locations together.</p><nav className="administration-task-links" aria-label="Organization settings"><Link href="/app/organization">Organization details →</Link><Link href="/app/organization#departments">Departments →</Link><Link href="/app/organization#locations">Locations →</Link></nav></article>
      <article className="settings-card"><h3>People &amp; access</h3><p>Invite people and manage their roles and access.</p><nav className="administration-task-links" aria-label="People settings"><Link href="/app/people">Users &amp; invitations →</Link><Link href="/app/people?view=technicians">Technicians →</Link></nav></article>
      <article className="settings-card"><h3>Knowledge Base</h3><p>Create help articles for employees and review their feedback.</p><nav className="administration-task-links" aria-label="Knowledge settings"><Link href="/app/help?view=all">Manage articles →</Link><Link href="/app/help/new">Write an article →</Link></nav></article>
    </div></section>
    <section className="administration-group" aria-labelledby="policies-heading"><h2 id="policies-heading">Policies &amp; activity</h2><p className="muted">Review how support is configured today. These policies cannot be edited yet.</p><div className="settings-grid">{policies.map(item => <Link className="settings-card administration-link" key={item.slug} href={`/app/administration/${item.slug}`}><div className="administration-card-heading"><h3>{item.slug === 'slas' ? 'Priorities & SLAs' : item.title}</h3><span className="badge">{item.status}</span></div><p>{item.description}</p></Link>)}</div></section>
    <details className="administration-planned"><summary>Coming later</summary><p className="muted"><strong>Assets — Planned.</strong> Asset inventory and ticket associations are not available yet.</p></details>
  </div>;
}
