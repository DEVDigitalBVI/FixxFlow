import {notFound} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {AssetForm} from '@/features/assets/asset-form';
import {assetOptions} from '@/features/assets/options';
export default async function NewAssetPage(){const viewer=await requireViewer();if(viewer.role==='end_user')notFound();const options=await assetOptions(viewer.organizationId);return <div className="page"><header className="page-header"><div><h1>Add asset</h1><p>Give equipment a unique tag so it can be found and linked to support tickets.</p></div></header><AssetForm {...options}/></div>;}
