/** Synthetic new-ticket rendering; no database or credentials are accessed. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../helpers/load-module.mjs';
export const ticketCreateData = {
 profiles:[{user_id:'worker',display_name:'Jamie Chen'},{user_id:'employee',display_name:'Alex Morgan'}],
 organization_memberships:[{user_id:'worker',role:'technician',status:'active'},{user_id:'employee',role:'end_user',status:'active'}],
 teams:[{id:'team',name:'IT support'}],ticket_categories:[{id:'category',name:'Connectivity',is_active:true}],
 ticket_subcategories:[{id:'subcategory',category_id:'category',name:'VPN',is_active:true}],locations:[{id:'location',name:'Main office'}],knowledge_articles:[],assets:{id:'asset',name:'Work laptop',tag:'LT-1042'},
};
export async function renderTicketCreate({role='technician',errors=[],params={}}={}) {
 const builder=table=>new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:errors.includes(table)?null:ticketCreateData[table],error:errors.includes(table)?{}:null}).then(resolve):()=>builder(table)});
 const Page=load('src/app/app/tickets/new/page.tsx',{
  'next/link':{default:props=>React.createElement('a',props)},
  'next/navigation':{useRouter:()=>({push(){},refresh(){}})},
  '@/lib/auth/viewer':{requireViewer:async()=>({role,id:role==='end_user'?'employee':'worker',organizationId:'synthetic'})},
  '@/lib/supabase/server':{createClient:async()=>({from:table=>builder(table)})},
  '../actions':{createTicket:async()=>({error:'Synthetic failure: your draft is preserved.'})},
 }).default;
 return renderToStaticMarkup(await Page({searchParams:Promise.resolve(params)}));
}
