'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {assetInput,type SaveState} from '@/features/assets/model';
export async function saveAsset(id:string|null,revision:number,previous:SaveState,form:FormData):Promise<SaveState> {
 const viewer=await requireViewer();
 if(viewer.role==='end_user')return {error:'Only IT staff can manage assets.'};
 const parsed=assetInput(form);if(!parsed.data)return {error:parsed.error};
 const db=await createClient();
 const query=id?db.from('assets').update(parsed.data).eq('organization_id',viewer.organizationId).eq('id',id).eq('revision',revision):db.from('assets').insert({...parsed.data,organization_id:viewer.organizationId});
 const {data,error}=await query.select('id').maybeSingle();
 if(error)return {error:error.code==='23505'?'That asset tag is already in use. Choose a unique tag.':'The asset could not be saved. Check the employee, location and dates, then try again. Your draft is preserved.'};
 if(!data)return {error:'This asset changed or is no longer available. Open it in another tab to compare the latest details before retrying.'};
 revalidatePath('/app/assets');revalidatePath(`/app/assets/${data.id}`);
 redirect(`/app/assets/${data.id}?saved=1`);
}
export async function changeAssetLink(ticketId:string,previous:SaveState,form:FormData):Promise<SaveState> {
 const viewer=await requireViewer();if(viewer.role==='end_user')return {error:'Only IT staff can link assets.'};
 const assetId=String(form.get('assetId')??'');const mode=String(form.get('mode')??'link');
 if(!/^[0-9a-f-]{36}$/i.test(assetId)||!['link','unlink'].includes(mode))return {error:'Choose an asset.'};
 const db=await createClient();
 const query=mode==='link'?db.from('ticket_assets').insert({organization_id:viewer.organizationId,ticket_id:ticketId,asset_id:assetId}):db.from('ticket_assets').delete().eq('organization_id',viewer.organizationId).eq('ticket_id',ticketId).eq('asset_id',assetId);
 const {error}=await query;
 if(error&&!(mode==='link'&&error.code==='23505'))return {error:'The asset link could not be saved. Refresh and try again.'};
 revalidatePath(`/app/tickets/${ticketId}`);revalidatePath(`/app/assets/${assetId}`);
 return {success:mode==='link'?'Asset linked.':'Asset unlinked.'};
}
