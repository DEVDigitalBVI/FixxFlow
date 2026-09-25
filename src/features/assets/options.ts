import {createClient} from '@/lib/supabase/server';
export async function assetOptions(org:string) {
 const db=await createClient();const [p,l]=await Promise.all([db.from('profiles').select('user_id,display_name').eq('organization_id',org).order('display_name'),db.from('locations').select('id,name').eq('organization_id',org).order('name')]);
 if(p.error||l.error)throw Error('Asset options unavailable');return {people:p.data??[],locations:l.data??[]};
}
