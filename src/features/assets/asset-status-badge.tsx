import { Badge, type BadgeTone } from '@/components/ui/badge';

import { assetStatuses, type Asset } from './model';

const assetTones: Record<Asset['status'], BadgeTone> = {
  available: 'success',
  in_use: 'active',
  repair: 'warning',
  retired: 'muted',
};

/** Lifecycle labels stay authoritative; tones only reinforce the written state. */
export function AssetStatusBadge({
  status,
  assigned = false,
}: {
  status: Asset['status'];
  assigned?: boolean;
}) {
  return (
    <Badge tone={assetTones[status]} className={`asset-status asset-status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {status === 'available' && assigned
        ? 'Assigned · Review availability'
        : assetStatuses[status]}
    </Badge>
  );
}
