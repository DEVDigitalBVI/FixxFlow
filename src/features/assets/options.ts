import {createClient} from '@/lib/supabase/server';
/** Only the current asset's display references; editors load searchable pages. */
export async function assetOptions(org:string, userId?:string|null, locationId?:string|null) {
 const db=await createClient();const [p,l]=await Promise.all([
  userId ? db.from('profiles').select('user_id,display_name').eq('organization_id',org).eq('user_id',userId) : {data:[],error:null},
  locationId ? db.from('locations').select('id,name').eq('organization_id',org).eq('id',locationId) : {data:[],error:null},
 ]);
 if(p.error||l.error)throw Error('Asset details unavailable');return {people:p.data??[],locations:l.data??[]};
}
