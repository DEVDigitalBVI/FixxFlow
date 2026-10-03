import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import {notFound} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {AssetForm} from '@/features/assets/asset-form';

export default async function NewAssetPage(){const viewer=await requireViewer();if(viewer.role==='end_user')notFound();return <div className="page"><PageHeader title="Add asset" eyebrow="Assets" description="Give equipment a unique tag so it can be found and linked to support tickets." back={{href:"/app/assets",label:"Assets"}} actions={<Link className="button button-secondary" href="/app/assets/import">Import spreadsheet</Link>}/><AssetForm/></div>;}
