import { assetKinds, type Asset } from './model';

function AssetDate({ value }: { value: string | null }) {
  if (!value) return <>Not recorded</>;
  return <time dateTime={value}>{new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))}</time>;
}

/** Readable saved values, separate from the editable draft. */
export function AssetOverview({ asset, owner, location }: { asset: Asset; owner: string; location: string }) {
  return <div className="asset-overview-grid">
    <section className="asset-overview-identity" aria-labelledby="asset-identity-heading">
      <h3 id="asset-identity-heading">Identity</h3>
      <dl className="asset-record-facts">
        <div><dt>Asset tag</dt><dd>{asset.tag}</dd></div>
        <div><dt>Type</dt><dd>{assetKinds[asset.kind]}</dd></div>
        <div><dt>Model</dt><dd>{asset.model || 'Not recorded'}</dd></div>
        <div><dt>Serial number</dt><dd>{asset.serial_number || 'Not recorded'}</dd></div>
      </dl>
    </section>
    <section aria-labelledby="asset-assignment-heading"><h3 id="asset-assignment-heading">Assignment</h3><dl className="asset-record-facts"><div><dt>Assigned employee</dt><dd>{owner}</dd></div><div><dt>Location</dt><dd>{location}</dd></div></dl></section>
    <section aria-labelledby="asset-warranty-heading"><h3 id="asset-warranty-heading">Purchase & warranty</h3><dl className="asset-record-facts"><div><dt>Purchased</dt><dd><AssetDate value={asset.purchased_on}/></dd></div><div><dt>Warranty ends</dt><dd><AssetDate value={asset.warranty_until}/></dd></div></dl></section>
  </div>;
}
