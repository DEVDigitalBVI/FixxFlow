/** Synthetic rendering fixture. No Supabase client, credentials or mutations. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../helpers/load-module.mjs';
import { searchNavigation } from '../helpers/search-navigation.mjs';
const { normalizeQueueFilters } = load('src/features/tickets/queue-filters.ts');
export const queueRows = ['VPN disconnects during video calls', 'New starter equipment request', 'Unable to access the finance shared drive', 'Meeting room display is offline', 'Email delivery delayed for external recipients', 'Install approved design software'].map((title,i)=>({
 id:`ticket-${i}`,title,ticket_number:1842+i,status:['open','new','in_progress','waiting_on_user','on_hold','resolved'][i],priority:['high','normal','critical','normal','low','normal'][i],requester_id:'requester',assigned_technician_id:i%2?'worker':null,team_id:'team',updated_at:'2026-10-03T09:30:00Z',created_at:'2026-10-03T08:30:00Z',due_at:null,response_sla_due_at:null,resolution_sla_due_at:null,first_response_at:null,resolved_at:null,closed_at:null,
}));
export async function renderTicketQueue({filters={},role='technician',rows=queueRows,error=null}={}) {
 const Page=load('src/app/app/tickets/page.tsx',{
  'next/navigation':searchNavigation,
  'next/link':{default:props=>React.createElement('a',props)},
  '@/lib/auth/viewer':{requireViewer:async()=>({role,organizationName:'Northwind workspace'})},
  '@/features/tickets/data':{loadTicketQueue:async()=>({...normalizeQueueFilters(filters),page:Number(filters.page)||1,rows,error,profiles:[{user_id:'requester',display_name:'Alex Morgan'},{user_id:'worker',display_name:'Jamie Chen'}],teams:[{id:'team',name:'IT support'}],members:[{user_id:'worker'}],knowledgeCount:0})},
  '@/features/product-analytics/usage-event':{UsageEvent:()=>null},
  '@/features/tickets/conversation-refresh':{ConversationRefresh:()=>null},
  './actions':{bulkUpdateTickets:async()=>{}},
 }).default;
 return renderToStaticMarkup(await Page({searchParams:Promise.resolve(filters)}));
}
