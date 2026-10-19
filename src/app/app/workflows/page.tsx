import {WorkflowCatalog,type CatalogParams} from '@/features/workflows/catalog';
export default async function Page({searchParams}:{searchParams:Promise<CatalogParams>}){return <WorkflowCatalog params={await searchParams}/>;}
