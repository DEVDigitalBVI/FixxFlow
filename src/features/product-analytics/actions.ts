'use server';
import { after } from 'next/server';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { allowedPageEvent, type PageEvent, type UsageSurface } from './events';

export async function recordUsage(event:PageEvent,surface:UsageSurface,targetId:string|null,eventToken:string) {
  if(!allowedPageEvent(event,surface))return;
  try {
    const viewer=await requireViewer();
    if(!viewer.usageSharing)return;
    const client=await createClient();
    after(async()=>{try {await client.rpc('record_product_usage',{event_name:event,event_surface:surface,org:viewer.organizationId,target_id:targetId,event_token:eventToken});} catch { /* Usage collection never interrupts work. */ }});
  } catch { /* Expired sessions and analytics failures are not user-facing errors. */ }
}

export async function recordCompletedLogin() {
  try {
    const client=await createClient();
    after(async()=>{try {await client.rpc('record_product_usage',{event_name:'login',event_surface:'workspace'});} catch { /* Do not interrupt authentication. */ }});
  } catch { /* Analytics is optional. */ }
}
