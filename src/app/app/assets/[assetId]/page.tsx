import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { AssetDetailEditor } from '@/features/assets/asset-detail-editor';
import { AssetOverview } from '@/features/assets/asset-overview';
import { AssetStatusBadge } from '@/features/assets/asset-status-badge';
import { assetKinds } from '@/features/assets/model';
import { assetOptions } from '@/features/assets/options';
import { inventoryAccess } from '@/features/inventory/access';
import { UsageEvent } from '@/features/product-analytics/usage-event';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

type Database = Awaited<ReturnType<typeof createClient>>;

async function loadTicketHistory(db: Database, organizationId: string, assetId: string) {
  const links = await db
    .from('ticket_assets')
    .select('ticket_id')
    .eq('organization_id', organizationId)
    .eq('asset_id', assetId);
  const ids = links.data?.map((l) => l.ticket_id) ?? [];
  const tickets = ids.length
    ? await db
        .from('tickets')
        .select('id,ticket_number,title,status')
        .eq('organization_id', organizationId)
        .in('id', ids)
        .order('updated_at', { ascending: false })
        .limit(50)
    : null;
  return { links, tickets };
}

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const viewer = await requireViewer();
  const { assetId } = await params;
  const { saved } = await searchParams;
  const db = await createClient();
  const [{ data: asset, error }, access] = await Promise.all([
    db
      .from('assets')
      .select('*')
      .eq('organization_id', viewer.organizationId)
      .eq('id', assetId)
      .maybeSingle(),
    inventoryAccess(viewer),
  ]);
  if (error) throw Error('Asset unavailable');
  if (!asset) notFound();
  const staff = viewer.role !== 'end_user';
  // Independent lookups run together; ticket history is its own two-step chain.
  const [inventoryUnit, options, { links, tickets }] = await Promise.all([
    access.manager
      ? db
          .from('inventory_equipment')
          .select('item_id')
          .eq('organization_id', viewer.organizationId)
          .eq('asset_id', asset.id)
          .maybeSingle()
      : null,
    staff ? assetOptions(viewer.organizationId, asset.assigned_user_id, asset.location_id) : null,
    staff ? loadTicketHistory(db, viewer.organizationId, asset.id) : { links: null, tickets: null },
  ]);
  return (
    <div className={staff ? 'page assets-page' : 'portal-page assets-page'}>
      {viewer.usageSharing && (
        <UsageEvent key={asset.id} event="asset_viewed" surface="assets" targetId={asset.id} />
      )}
      <PageHeader
        title={asset.name}
        eyebrow={asset.tag}
        description={assetKinds[asset.kind]}
        back={{
          href: inventoryUnit?.data
            ? `/app/inventory/${inventoryUnit.data.item_id}`
            : '/app/assets',
          label: inventoryUnit?.data
            ? 'Back to inventory'
            : staff
              ? 'Back to assets'
              : 'My equipment',
        }}
        actions={<AssetStatusBadge status={asset.status} />}
      />
      {saved && (
        <Alert as="p" tone="success" role="status">
          Asset saved.
        </Alert>
      )}
      {staff && options ? (
        <AssetDetailEditor key={`${asset.id}:${asset.revision}:${saved ?? ''}`} asset={asset}>
          <AssetOverview
            asset={asset}
            owner={
              asset.assigned_user_id
                ? (options.people.find((p) => p.user_id === asset.assigned_user_id)?.display_name ??
                  'Employee unavailable')
                : 'Unassigned'
            }
            location={
              asset.location_id
                ? (options.locations.find((l) => l.id === asset.location_id)?.name ??
                  'Location unavailable')
                : 'Not assigned'
            }
          />
        </AssetDetailEditor>
      ) : (
        <section className="portal-detail-card">
          <h2>Equipment details</h2>
          <dl className="asset-facts">
            <dt>Model</dt>
            <dd>{asset.model ?? 'Not set'}</dd>
            <dt>Serial number</dt>
            <dd>{asset.serial_number ?? 'Not set'}</dd>
            <dt>Warranty ends</dt>
            <dd>{asset.warranty_until ?? 'Not set'}</dd>
          </dl>
          {asset.assigned_user_id === viewer.id && (
            <Link
              className={buttonVariants({ variant: 'primary' })}
              href={`/app/tickets/new?asset=${asset.id}`}
            >
              Get help with this equipment
            </Link>
          )}
        </section>
      )}
      {staff && (
        <section className="settings-card asset-history">
          <h2>Ticket history</h2>
          {links?.error || tickets?.error ? (
            <p role="alert">History could not load. Refresh to try again.</p>
          ) : tickets?.data?.length ? (
            <ul className="asset-history-list">
              {tickets.data.map((t) => (
                <li key={t.id}>
                  <div>
                    <span className="muted">Ticket #{t.ticket_number}</span>
                    <p>{t.title}</p>
                  </div>
                  <Link
                    className={buttonVariants({ variant: 'secondary' })}
                    href={`/app/tickets/${t.id}`}
                  >
                    Open ticket<span className="sr-only"> #{t.ticket_number}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No tickets linked. Open a ticket and use its Linked assets section.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
