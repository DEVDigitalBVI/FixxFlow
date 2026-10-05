import {PageHeader} from '@/components/ui/page-header';
import {notFound} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {AssetImport} from '@/features/assets/asset-import';
export default async function AssetImportPage() {
 const viewer=await requireViewer();if(viewer.role==='end_user')notFound();
 return <div className="page"><PageHeader title="Import assets" eyebrow={viewer.organizationName} description="Add equipment from a CSV or Excel spreadsheet. Review every batch before saving." back={{href:'/app/assets',label:'Back to assets'}}/><AssetImport/></div>;
}
