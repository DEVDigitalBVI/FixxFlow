'use server';
import {revalidatePath} from 'next/cache';
import {requirePlatformOwner} from '@/lib/auth/platform';
import {createClient} from '@/lib/supabase/server';
import type {SaveState} from '@/features/assets/model';
export async function saveCustomer(target:string|null,previous:SaveState,form:FormData):Promise<SaveState>{
 await requirePlatformOwner();const name=String(form.get('name')??'').trim();const slug=String(form.get('slug')??'').trim().toLowerCase();const email=String(form.get('email')??'').trim();const admin=String(form.get('admin')??'').trim();
 if(name.length<2||name.length>120)return {error:'Enter an organization name between 2 and 120 characters.'};
 if(!target&&(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length<2||slug.length>63||!email.includes('@')||email.length>254||!admin||admin.length>120))return {error:'Enter a valid workspace address and administrator name and email.'};
 const db=await createClient();const {error}=await db.rpc('manage_customer',{target,customer_name:name,...(!target?{customer_slug:slug,admin_email:email,admin_name:admin}:{})});
 if(error)return {error:target?'The organization could not be updated. Refresh and try again.':'Setup could not finish. Use a unique workspace address and a verified account that does not already belong to an organization. Your entries are preserved.'};
 revalidatePath('/platform/customers');revalidatePath('/platform/audit');revalidatePath('/app','layout');
 return {success:target?'Organization name saved.':'Organization created. The administrator can now sign in.'};
}
