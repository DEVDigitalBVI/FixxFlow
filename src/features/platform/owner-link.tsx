import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
export async function OwnerConsoleLink({ className }: { className?: string } = {}){const db=await createClient();const {data}=await db.rpc('platform_access');return data&&data!=='none'?<Link className={className} href="/platform">Open platform console</Link>:null;}
