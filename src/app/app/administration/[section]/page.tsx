import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ClassificationEditor } from '@/features/administration/classification-editor';
import { administrationSections } from '@/features/administration/sections';
import { SlaPolicyEditor } from '@/features/administration/sla-policy-editor';
import { AuditLog, type AuditFilters } from '@/features/audit/audit-log';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { parseSlaPolicy } from '@/features/tickets/organization-sla';
import { requireViewer } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

export default async function AdministrationSection({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<AuditFilters>;
}) {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const { section } = await params;
  const item = administrationSections.find((item) => item.slug === section);
  if (!item || 'href' in item) notFound();
  const filters = await searchParams;
  const page = pageNumber(filters.page, 999999);
  const supabase = await createClient();
  let content;
  if (section === 'teams' || section === 'categories') {
    const { data, error } = await supabase
      .from(section === 'teams' ? 'teams' : 'ticket_categories')
      .select('*')
      .eq('organization_id', viewer.organizationId)
      .order('name')
      .order('id')
      .range((page - 1) * 50, page * 50);
    if (error) throw new Error('Unable to load administration settings.');
    const routingTeams =
      section === 'categories'
        ? await supabase
            .from('teams')
            .select('id, name, is_active')
            .eq('organization_id', viewer.organizationId)
            .order('name')
        : { data: [], error: null };
    if (routingTeams.error) throw new Error('Unable to load routing teams.');
    const visible = data.slice(0, 50);
    const children =
      section === 'categories' && visible.length
        ? await supabase
            .from('ticket_subcategories')
            .select('id, category_id, name, is_active, updated_at')
            .eq('organization_id', viewer.organizationId)
            .in(
              'category_id',
              visible.map((row) => row.id),
            )
            .order('name')
        : { data: [], error: null };
    if (children.error) throw new Error('Unable to load subcategories.');
    const kind = section === 'teams' ? 'teams' : 'ticket_categories';
    content = (
      <>
        <p>
          Manage names and availability. Inactive entries stay linked to existing tickets and are
          hidden from new selections.
        </p>
        {section === 'categories' &&
          visible.some((row, i) =>
            visible.some(
              (other, j) =>
                i < j &&
                row.name
                  .toLocaleLowerCase()
                  .split(/[^\p{L}\p{N}]+/u)
                  .filter((part) => part.length > 3)
                  .some((part) =>
                    other.name
                      .toLocaleLowerCase()
                      .split(/[^\p{L}\p{N}]+/u)
                      .includes(part),
                  ),
            ),
          ) && (
            <Alert tone="warning" role="status">
              Some category names on this page overlap. Review their routing and rename them to make
              their purpose distinct. Existing tickets and history are preserved.
            </Alert>
          )}
        <ClassificationEditor kind={kind} teams={routingTeams.data ?? []} />
        {!data.length && <p>No {section} found on this page.</p>}
        <div className="management-list">
          {visible.map((row) => (
            <details className="settings-editor" key={row.id}>
              <summary>
                <strong>{row.name}</strong> <Badge>{row.is_active ? 'Active' : 'Inactive'}</Badge>
                <span className="muted">
                  Edit{section === 'categories' ? ' and manage subcategories' : ''}
                </span>
              </summary>
              <ClassificationEditor kind={kind} item={row} teams={routingTeams.data ?? []} />
              {section === 'categories' && (
                <section aria-label={`Subcategories of ${row.name}`}>
                  <h3>Subcategories</h3>
                  <p className="muted">
                    Subcategories are available on new tickets only when their parent category is
                    active.
                  </p>
                  {(children.data ?? [])
                    .filter((child) => child.category_id === row.id)
                    .map((child) => (
                      <details className="settings-editor" key={child.id}>
                        <summary>
                          {child.name} · {child.is_active ? 'Active' : 'Inactive'}
                        </summary>
                        <ClassificationEditor
                          kind="ticket_subcategories"
                          item={child}
                          categoryId={row.id}
                        />
                      </details>
                    ))}
                  <ClassificationEditor kind="ticket_subcategories" categoryId={row.id} />
                </section>
              )}
            </details>
          ))}
        </div>
        <Pagination section={section} page={page} hasNext={data.length > 50} />
      </>
    );
  } else if (section === 'audit-log') {
    content = <AuditLog organizationId={viewer.organizationId} filters={filters} />;
  } else if (section === 'slas' || section === 'priorities') {
    const { data, error } = await supabase.rpc('organization_sla_policy', {
      org: viewer.organizationId,
    });
    if (error) throw new Error('Unable to load SLA settings. Please try again.');
    content = (
      <SlaPolicyEditor policy={parseSlaPolicy(data)} timeZone={viewer.organizationTimezone} />
    );
  } else if (section === 'notifications') {
    const emailConfigured = Boolean(getNotificationEmailConfiguration(process.env));
    content = (
      <>
        <p>
          In-app notifications are enabled. Email delivery:{' '}
          <strong>
            {emailConfigured
              ? 'Resend configured; delivery depends on provider availability'
              : 'Resend setup incomplete; contact your deployment administrator'}
          </strong>
          .
        </p>
        <p>
          Notifications cover assignment, reassignment, replies, chats, approaching SLAs,
          resolution, and reopening. Internal notes do not notify requesters.
        </p>
        <p>
          Repeated notifications are grouped to reduce noise. Choose email frequency, quiet hours
          and timezone in your notification preferences.
        </p>
        <Link className={buttonVariants({ variant: 'secondary' })} href="/app/notifications">
          Open your notifications
        </Link>
        <Link
          className={buttonVariants({ variant: 'secondary' })}
          href="/app/notifications/settings"
        >
          Notification preferences
        </Link>
      </>
    );
  } else if (section === 'security') {
    content = (
      <>
        <p>
          Workspace access follows active membership and assigned roles. Data access is restricted
          to the organization and the records each role can view.
        </p>
        <p>
          Two-factor authentication can be enrolled per account. Once enrolled, verification is
          required to access the workspace. Organization-wide enrollment enforcement and
          configurable security policies are planned.
        </p>
        <Link className={buttonVariants({ variant: 'secondary' })} href="/app/security">
          Manage your two-factor authentication
        </Link>
        <Link className={buttonVariants({ variant: 'quiet' })} href="/app/people">
          Review member access
        </Link>
      </>
    );
  } else {
    content = (
      <p>
        Asset inventory is available. Manage equipment, employee assignments and ticket history from
        Assets.
      </p>
    );
  }
  return (
    <div className="page">
      <PageHeader
        title={item.title}
        eyebrow={item.status === 'Fixed' ? 'Settings · Read only' : 'Settings'}
        description={item.description}
        back={{ href: '/app/administration', label: 'Back to settings' }}
      />
      <section className="settings-card">{content}</section>
    </div>
  );
}
function Pagination({
  section,
  page,
  hasNext,
}: {
  section: string;
  page: number;
  hasNext: boolean;
}) {
  if (page <= 1 && !hasNext) return null;
  return (
    <nav className="queue-views" aria-label="Administration pages">
      {page > 1 && (
        <Link
          className={buttonVariants({ variant: 'secondary' })}
          href={`/app/administration/${section}?page=${page - 1}`}
        >
          Previous
        </Link>
      )}
      <span>Page {page}</span>
      {hasNext && (
        <Link
          className={buttonVariants({ variant: 'secondary' })}
          href={`/app/administration/${section}?page=${page + 1}`}
        >
          Next
        </Link>
      )}
    </nav>
  );
}
