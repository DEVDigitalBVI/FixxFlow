import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { AssetStatusBadge } from '@/features/assets/asset-status-badge';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { pageNumber } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

export default async function PersonEquipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ page?: string; current?: string }>;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') notFound();
  const { userId } = await params;
  if (!isUuid(userId)) notFound();
  const filters = await searchParams,
    page = pageNumber(filters.page),
    current = pageNumber(filters.current),
    db = await createClient();
  const [member, profile, assets, history] = await Promise.all([
    db
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', viewer.organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
    db
      .from('profiles')
      .select('display_name')
      .eq('organization_id', viewer.organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
    db
      .from('assets')
      .select('id,tag,name,status', { count: 'exact' })
      .eq('organization_id', viewer.organizationId)
      .eq('assigned_user_id', userId)
      .order('tag')
      .order('id')
      .range((current - 1) * 25, current * 25 - 1),
    db
      .from('asset_assignments')
      .select('*', { count: 'exact' })
      .eq('organization_id', viewer.organizationId)
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .order('id')
      .range((page - 1) * 25, page * 25 - 1),
  ]);
  if ([member, profile, assets, history].some((r) => r.error))
    throw Error('Equipment history could not load. Try again.');
  if (!member.data) notFound();
  const ids = [...new Set((history.data ?? []).map((r) => r.asset_id))];
  const labels = ids.length
    ? await db
        .from('assets')
        .select('id,tag,name')
        .eq('organization_id', viewer.organizationId)
        .in('id', ids)
    : { data: [], error: null };
  if (labels.error) throw Error('Equipment details could not load.');
  const byId = new Map((labels.data ?? []).map((a) => [a.id, a]));
  const href = (p: number, c: number) => `/app/people/${userId}/equipment?page=${p}&current=${c}`;
  return (
    <div className="page stack">
      <PageHeader
        title={`${profile.data?.display_name ?? 'Employee'} · Equipment`}
        description="Current assignments and equipment history."
        back={{ href: '/app/people', label: 'Back to people' }}
      />
      <section className="settings-card stack">
        <h2>Currently assigned · {assets.count ?? 0}</h2>
        {assets.data?.length ? (
          <ul className="stack">
            {assets.data.map((a) => (
              <li key={a.id}>
                <Link href={`/app/assets/${a.id}`}>
                  {a.tag} · {a.name}
                </Link>{' '}
                <AssetStatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p>No equipment assigned.</p>
        )}
        <nav className="page-header-actions" aria-label="Current equipment pages">
          {current > 1 && <Link href={href(page, current - 1)}>Previous</Link>}
          {current * 25 < (assets.count ?? 0) && (
            <Link href={href(page, current + 1)}>More equipment</Link>
          )}
        </nav>
      </section>
      <section className="settings-card stack">
        <h2>Assignment history</h2>
        {history.data?.length ? (
          <div
            className="table-region"
            role="region"
            tabIndex={0}
            aria-label="Equipment assignment history"
          >
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th scope="col">Equipment</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Returned / reassigned</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Equipment">
                      <Link href={`/app/assets/${r.asset_id}`}>
                        {byId.get(r.asset_id)?.tag ?? 'Asset'} ·{' '}
                        {byId.get(r.asset_id)?.name ?? 'Equipment'}
                      </Link>
                    </td>
                    <td data-label="Assigned">
                      {r.assigned_at ? (
                        <Timestamp value={r.assigned_at} />
                      ) : (
                        'Assigned before history began'
                      )}
                    </td>
                    <td data-label="Returned / reassigned">
                      {r.returned_at ? <Timestamp value={r.returned_at} /> : 'Still assigned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No recorded assignment history.</p>
        )}
        <nav className="page-header-actions" aria-label="Assignment history pages">
          {page > 1 && <Link href={href(page - 1, current)}>Previous</Link>}
          {page * 25 < (history.count ?? 0) && (
            <Link href={href(page + 1, current)}>More history</Link>
          )}
        </nav>
      </section>
    </div>
  );
}
