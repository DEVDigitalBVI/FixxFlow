import { ClassificationEditor } from "@/features/administration/classification-editor";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { administrationSections, fixedSlaTargets, formatMinutes } from '@/features/administration/sections';
import { AuditLog, type AuditFilters } from '@/features/audit/audit-log';
import { ticketPriorities } from '@/features/tickets/presentation';

export default async function AdministrationSection({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<AuditFilters> }) {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const { section } = await params;
  const item = administrationSections.find(item => item.slug === section);
  if (!item || 'href' in item) notFound();
  const filters = await searchParams;
  const rawPage = filters.page;
  const page = rawPage && /^\d{1,6}$/.test(rawPage) ? Math.max(1, Number(rawPage)) : 1;
  const supabase = await createClient();
  let content;
  if (section === 'teams' || section === 'categories') {
    const { data, error } = await supabase.from(section === 'teams' ? 'teams' : 'ticket_categories').select('*').eq('organization_id', viewer.organizationId).order('name').order('id').range((page - 1) * 50, page * 50);
    if (error) throw new Error('Unable to load administration settings.');
    const routingTeams = section === 'categories' ? await supabase.from('teams').select('id, name, is_active').eq('organization_id', viewer.organizationId).order('name') : { data: [], error: null };
    if (routingTeams.error) throw new Error('Unable to load routing teams.');
    const visible = data.slice(0, 50);
    const children = section === 'categories' && visible.length
      ? await supabase.from('ticket_subcategories').select('id, category_id, name, is_active, updated_at').eq('organization_id', viewer.organizationId).in('category_id', visible.map(row => row.id)).order('name')
      : { data: [], error: null };
    if (children.error) throw new Error('Unable to load subcategories.');
    const kind = section === 'teams' ? 'teams' : 'ticket_categories';
    content = <>
      <p>Manage names and availability. Inactive entries stay linked to existing tickets and are hidden from new selections.</p>
      <ClassificationEditor kind={kind} teams={routingTeams.data ?? []}/>
      {!data.length && <p>No {section} found on this page.</p>}
      <div className="management-list">{visible.map(row => <details className="settings-editor" key={row.id}>
        <summary><strong>{row.name}</strong> <span className="badge">{row.is_active ? 'Active' : 'Inactive'}</span><span className="muted">Edit{section === 'categories' ? ' and manage subcategories' : ''}</span></summary>
        <ClassificationEditor kind={kind} item={row} teams={routingTeams.data ?? []}/>
        {section === 'categories' && <section aria-label={`Subcategories of ${row.name}`}><h3>Subcategories</h3>
          <p className="muted">Subcategories are available on new tickets only when their parent category is active.</p>
          {(children.data ?? []).filter(child => child.category_id === row.id).map(child => <details className="settings-editor" key={child.id}><summary>{child.name} · {child.is_active ? 'Active' : 'Inactive'}</summary><ClassificationEditor kind="ticket_subcategories" item={child} categoryId={row.id}/></details>)}
          <ClassificationEditor kind="ticket_subcategories" categoryId={row.id}/>
        </section>}
      </details>)}</div>
      <Pagination section={section} page={page} hasNext={data.length > 50}/>
    </>;
  } else if (section === 'audit-log') {
    content = <AuditLog organizationId={viewer.organizationId} filters={filters}/>;
  } else if (section === 'slas' || section === 'priorities') {
    content = <><p>These values are fixed. SLAs count calendar hours, including weekends. Business hours and custom policies are planned.</p><div className="table-region" role="region" aria-label="Priority and SLA targets" tabIndex={0}><table className="table table-policy responsive-table"><caption>Current response and resolution targets</caption><thead><tr><th scope="col">Priority</th><th scope="col">First response</th><th scope="col">Resolution</th></tr></thead><tbody>{fixedSlaTargets.map(target => <tr key={target.priority}><th scope="row" data-label="Priority">{ticketPriorities[target.priority].label}</th><td data-label="First response">{formatMinutes(target.response)}</td><td data-label="Resolution">{formatMinutes(target.resolution)}</td></tr>)}</tbody></table></div></>;
  } else if (section === 'notifications') {
    const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATIONS_FROM_EMAIL && process.env.CRON_SECRET);
    content = <><p>In-app notifications are enabled. Email delivery: <strong>{emailConfigured ? 'Configured; delivery depends on provider availability' : 'Pending Resend setup'}</strong>.</p><p>Notifications cover assignment, reassignment, replies, chats, approaching SLAs, resolution, and reopening. Internal notes do not notify requesters.</p><p>Repeated notifications are grouped to reduce noise. Individual notification preferences are planned.</p><Link className="button button-secondary" href="/app/notifications">Open your notifications</Link></>;
  } else if (section === 'security') {
    content = <><p>Workspace access follows active membership and assigned roles. Data access is restricted to the organization and the records each role can view.</p><p>Two-factor authentication can be enrolled per account. Once enrolled, verification is required to access the workspace. Organization-wide enrollment enforcement and configurable security policies are planned.</p><Link className="button button-secondary" href="/app/security">Manage your two-factor authentication</Link><Link className="button button-quiet" href="/app/people">Review member access</Link></>;
  } else {
    content = <p>Asset inventory is available. Manage equipment, employee assignments and ticket history from Assets.</p>;
  }
  return <div className="page"><Link className="button button-quiet" href="/app/administration">Back to Administration</Link><header className="page-header"><div><span className="page-eyebrow">Administration · {item.status}</span><h1>{item.title}</h1><p>{item.description}</p></div></header><section className="settings-card">{content}</section></div>;
}
function Pagination({ section, page, hasNext }: { section: string; page: number; hasNext: boolean }) {
  return <nav className="queue-views" aria-label="Administration pages">{page > 1 && <Link className="button button-secondary" href={`/app/administration/${section}?page=${page - 1}`}>Previous</Link>}<span>Page {page}</span>{hasNext && <Link className="button button-secondary" href={`/app/administration/${section}?page=${page + 1}`}>Next</Link>}</nav>;
}
