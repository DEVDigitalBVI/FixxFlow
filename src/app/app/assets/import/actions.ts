'use server';
import {revalidatePath} from 'next/cache';
import {requireViewer} from '@/lib/auth/viewer';
import {createClient} from '@/lib/supabase/server';
import {assetInput} from '@/features/assets/model';
import {validateImport,type ImportResult,type ImportIssue} from '@/features/assets/import-model';

export async function importAssets(input:unknown, mode:'preview'|'save'):Promise<ImportResult> {
 const viewer=await requireViewer();
 if(viewer.role==='end_user')return {error:'Only IT staff can import assets.'};
 if(!['preview','save'].includes(mode))return {error:'Choose preview or import.'};
 const result=validateImport(input);
 if(result.error||result.issues?.length||!result.rows)return result;
 const rows=result.rows;const db=await createClient();const org=viewer.organizationId;
 const issues:ImportIssue[]=[];const tags=new Set<string>();
 const people=new Map<string,string[]>();const locations=new Map<string,string[]>();const active=new Set<string>();
 const chunks=(values:string[])=>Array.from({length:Math.ceil(values.length/50)},(_,i)=>values.slice(i*50,i*50+50));
 try {
  for(const group of chunks(rows.map(r=>r.tag))) {
   const r=await db.from('assets').select('tag').eq('organization_id',org).in('tag',group);
   if(r.error)throw Error();for(const asset of r.data??[])tags.add(asset.tag);
  }
  const emails=[...new Set(rows.map(r=>r.assigned_email).filter(Boolean))];
  for(const group of chunks(emails)) {
   const r=await db.from('profiles').select('user_id,email').eq('organization_id',org).in('email',group);
   if(r.error)throw Error();for(const person of r.data??[])if(person.email)people.set(person.email,[...(people.get(person.email)??[]),person.user_id]);
  }
  for(const group of chunks([...people.values()].flat())) {
   const r=await db.from('organization_memberships').select('user_id').eq('organization_id',org).eq('status','active').in('user_id',group);
   if(r.error)throw Error();for(const person of r.data??[])active.add(person.user_id);
  }
  for(const group of chunks([...new Set(rows.map(r=>r.location).filter(Boolean))])) {
   const r=await db.from('locations').select('id,name').eq('organization_id',org).eq('is_active',true).in('name',group);
   if(r.error)throw Error();for(const location of r.data??[])locations.set(location.name,[...(locations.get(location.name)??[]),location.id]);
  }
 } catch {return {rows,error:'The inventory and reference checks could not finish. Your preview is preserved. Try again.'};}
 const records=rows.map(row=>{
  if(tags.has(row.tag))issues.push({row:row.row,message:'This asset tag already exists. Existing assets are not changed by imports.'});
  const matches=(people.get(row.assigned_email)??[]).filter(id=>active.has(id));
  const places=locations.get(row.location)??[];
  if(row.assigned_email&&matches.length!==1)issues.push({row:row.row,message:'Employee email must match exactly one active employee in this organization.'});
  if(row.location&&places.length!==1)issues.push({row:row.row,message:'Location must match exactly one active location name in this organization.'});
  const form=new FormData();for(const [key,value] of Object.entries(row))form.set(key,String(value));
  form.set('assigned_user_id',row.assigned_email&&matches.length===1?matches[0]:'');form.set('location_id',row.location&&places.length===1?places[0]:'');
  const parsed=assetInput(form);
  if(parsed.error)issues.push({row:row.row,message:parsed.error});
  return {...parsed.data!,organization_id:org};
 });
 if(issues.length||mode==='preview')return {rows,issues};
 // One INSERT statement: any duplicate, reference, or RLS failure rolls back the entire batch.
 const {error}=await db.from('assets').insert(records);
 if(error)return {error:error.code==='23505'?'An asset tag already exists or was added after preview. No rows from this attempt were imported. Check inventory and preview again.':'Import could not be confirmed. Check inventory before retrying. Any saved batch is complete, and unique tags prevent duplicate assets.'};
 revalidatePath('/app/assets');
 return {success:`${rows.length} asset${rows.length===1?'':'s'} imported successfully.`};
}
