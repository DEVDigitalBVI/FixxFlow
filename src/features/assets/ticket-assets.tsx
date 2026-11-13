import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { AssetLinkForm } from './ticket-link-form';

export async function TicketAssets({
  ticketId,
  compact = false,
}: {
  ticketId: string;
  compact?: boolean;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return null;
  const db = await createClient();
  const { data: links, error } = await db
    .from('ticket_assets')
    .select('asset_id')
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticketId);
  const ids = (links ?? []).map((l) => l.asset_id);
  const { data: assets, error: assetError } = ids.length
    ? await db
        .from('assets')
        .select('id,tag,name')
        .eq('organization_id', viewer.organizationId)
        .in('id', ids)
    : { data: [], error: null };
  const content = (
    <section className="settings-card stack">
      <h2>Linked assets</h2>
      {error || assetError ? (
        <p role="alert">Assets could not load. Refresh to try again.</p>
      ) : (
        <>
          {assets?.length ? (
            <ul className="asset-link-list">
              {assets.map((a) => (
                <li key={a.id}>
                  <Link href={`/app/assets/${a.id}`}>
                    {a.tag} · {a.name}
                  </Link>
                  <AssetLinkForm ticketId={ticketId} asset={a} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No equipment linked to this ticket.</p>
          )}
          <AssetLinkForm ticketId={ticketId} />
          <Link href={`/app/assets?ticket=${ticketId}`}>
            Browse assets to link{' '}
            <NavigationIcon name="arrowRight" className="inline-icon" size={16} />
          </Link>
        </>
      )}
    </section>
  );
  return compact ? (
    <details className="ticket-disclosure">
      <summary>
        {error || assetError
          ? 'Assets · Unavailable'
          : assets?.length
            ? `Assets · ${assets.map((a) => a.tag).join(', ')}`
            : 'Add assets'}
      </summary>
      {content}
    </details>
  ) : (
    content
  );
}
