import {cache} from 'react';
import {notFound,redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
export const platformIdentity=cache(async()=>{
 const db=await createClient();const {data,error}=await db.auth.getClaims();if(error||!data?.claims?.sub)redirect('/login');
 const result=await db.rpc('platform_access');if(result.error)throw Error('Platform access could not be verified');if(!result.data||result.data==='none')notFound();
 return {id:data.claims.sub,email:String(data.claims.email??''),access:result.data};
});
export async function requirePlatformOwner(){const identity=await platformIdentity();if(identity.access!=='ready')redirect('/platform/access');return identity;}
