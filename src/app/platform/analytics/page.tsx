import {PlatformDashboard} from '@/features/platform/dashboard';
export default function Page({searchParams}:{searchParams:Promise<{q?:string;page?:string;days?:string}>}){return <PlatformDashboard section="analytics" searchParams={searchParams}/>;}
