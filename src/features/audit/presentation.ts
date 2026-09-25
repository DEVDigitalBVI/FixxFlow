import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { rolePresentation } from '@/features/identity/role';
import type { Json } from '@/types/database';
export const auditEntities: Record<string,string> = {assets:'Assets',ticket_assets:'Ticket asset links',tickets:'Tickets',organization_memberships:'Member access',organizations:'Organization',profiles:'Profiles',departments:'Departments',locations:'Locations',teams:'Teams',ticket_categories:'Categories',ticket_subcategories:'Subcategories',knowledge_articles:'Knowledge articles',chat_conversations:'Chats',ticket_messages:'Replies & notes'};
export const auditFields: Record<string,string> = {tag:'Asset tag',serial_number:'Serial number',model:'Model',assigned_user_id:'Assigned employee',purchased_on:'Purchase date',warranty_until:'Warranty end',asset_id:'Asset',title:'Title',description:'Description',status:'Status',priority:'Priority',requester_id:'Requester',assigned_technician_id:'Assigned to',team_id:'Team',category_id:'Category',subcategory_id:'Subcategory',location_id:'Location',department_id:'Department',due_at:'Due date',role:'Role',name:'Name',slug:'Workspace address',logo_path:'Logo',display_name:'Display name',is_active:'Available',timezone:'Timezone',category:'Category',content:'Article content',related_article_ids:'Related articles',ticket_id:'Linked ticket',kind:'Visibility',body:'Message content'};
export function auditValue(field:string,value:Json|undefined) {
  if (value===null || value===undefined || value==='') return field==='assigned_technician_id'?'Unassigned':'Not set';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(typeof value!=='string')return String(value);
  if(field==='status' && value in ticketStatuses)return ticketStatuses[value as keyof typeof ticketStatuses].label;
  if(field==='priority' && value in ticketPriorities)return ticketPriorities[value as keyof typeof ticketPriorities].label;
  if(field==='role' && value in rolePresentation)return rolePresentation[value as keyof typeof rolePresentation].label;
  if(field==='kind')return value==='internal_note'?'Internal note':value==='reply'?'Public reply':value;
  if(field==='due_at' && Number.isFinite(Date.parse(value)))return auditTime(value);
  return value;
}
export function auditTime(value:string) {return new Intl.DateTimeFormat('en',{timeZone:'America/Tortola',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
export function parseChanges(value:Json): {field:string;from?:Json;to?:Json}[] {
  return Array.isArray(value)?value.filter((v):v is {field:string;from?:Json;to?:Json}=>!!v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.field==='string'):[];
}
