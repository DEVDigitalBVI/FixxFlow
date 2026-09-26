import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {AssetImport} from '@/features/assets/asset-import';
export default async function AssetImportPage() {
 const viewer=await requireViewer();if(viewer.role==='end_user')notFound();
 return <div className="page"><header className="page-header"><div><span className="page-eyebrow">{viewer.organizationName}</span><h1>Import assets</h1><p>Add equipment from a CSV or Excel spreadsheet. Review every batch before saving.</p></div><Link className="button button-secondary" href="/app/assets">Back to assets</Link></header><AssetImport/></div>;
}
