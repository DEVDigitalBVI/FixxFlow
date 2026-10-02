import { assetStatuses, type Asset } from './model';

/** Lifecycle labels stay authoritative; tones only reinforce the written state. */
export function AssetStatusBadge({ status }: { status: Asset['status'] }) {
  return <span className={`badge asset-status asset-status-${status}`}><span className="status-dot" aria-hidden="true"/>{assetStatuses[status]}</span>;
}
