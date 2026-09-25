import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { administrationSections } from '@/features/administration/sections';

export default async function AdministrationPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">{viewer.organizationName}</span><h1>Administration</h1><p>Manage your workspace and review the policies that keep support running.</p></div></header>
    <p className="muted">Available settings can be managed now. Fixed and read-only settings will become configurable progressively.</p>
    {['Workspace', 'Service delivery', 'Governance'].map(group => <section className="administration-group" key={group} aria-label={group}><h2>{group}</h2><div className="settings-grid">{administrationSections.filter(item => item.group === group).map(item => <Link className={`settings-card administration-link admin-status-${item.status.toLowerCase().replaceAll(" ", "-")}`} key={item.slug} href={'href' in item ? item.href : `/app/administration/${item.slug}`}><div className="administration-card-heading"><h3>{item.title}</h3><span className="badge">{item.status}</span></div><p>{item.description}</p></Link>)}</div></section>)}
  </div>;
}
