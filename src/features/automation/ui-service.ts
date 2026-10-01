import 'server-only';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { normalizeSearch } from '@/lib/search';
import { isUuid } from './values';
import { validateDefinition, actionReferences } from './validation';
import { persistenceRegistry } from './persistence-contract';
import type { AutomationDefinition } from './model';
import type { Choice, Labels } from './ui-model';
import type { Database } from '@/types/database';
import type { AutomationExecutionRow } from '@/types/automation-execution-database';

export async function requireAutomationAdmin() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator' || viewer.status !== 'active') notFound();
  return viewer;
}
const unavailable = () => new Error('Automation information could not load. Please try again.');
async function session() { const viewer = await requireAutomationAdmin(); return { viewer, client: await createClient() }; }
async function read(args: Omit<Database['public']['Functions']['read_automation_admin']['Args'], 'org'>) {
  const { viewer, client } = await session();
  const { data, error } = await client.rpc('read_automation_admin', { ...args, org: viewer.organizationId });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
  return data as unknown as { rows: unknown[]; processingActive?: boolean };
}
export type AutomationListRow = { id: string; name: string; enabled: boolean; version: number; trigger_type: string; updated_at: string; archived_at: string | null; run_count: number; last_run: { started_at: string; status: string; error_code: string | null } | null };
export async function automationList(query: string, state: string, trigger: string, page: number) {
  const data = await read({ kind: 'list', query: normalizeSearch(query), state: ['all','enabled','disabled','archived'].includes(state) ? state : 'all', trigger_type: trigger, page_number: page });
  return { rows: data.rows.slice(0,50) as AutomationListRow[], hasNext: data.rows.length > 50, processingActive: process.env.AUTOMATION_PROCESSING_ENABLED === 'true' && data.processingActive === true };
}
/** Reuse the existing administrator/MFA-scoped read contract; no runtime control. */
export async function automationProcessingActive() {
  await requireAutomationAdmin();
  if (process.env.AUTOMATION_PROCESSING_ENABLED !== 'true') return false;
  return (await read({ kind: 'list', query: '', state: 'all', trigger_type: '', page_number: 1 })).processingActive === true;
}
export async function automationChoices(resource: string, query = '', page = 1, selected: string[] = []) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Array.isArray(selected) || selected.length > 100 || selected.some(id => !isUuid(id))) throw unavailable();
  const data = await read({ kind: 'choices', resource, query: normalizeSearch(query), page_number: page, selected });
  return { rows: data.rows.slice(0,selected.length ? 100 : 50) as Choice[], hasNext: !selected.length && data.rows.length > 50 };
}
export type EventChoice = { id: string; event_type: string; occurred_at: string; entity_version: number };
export async function automationEvents(ticketId: string, page = 1) {
  if (!isUuid(ticketId)) throw unavailable();
  const data = await read({ kind: 'events', target: ticketId, page_number: page });
  return { rows: data.rows.slice(0,50) as EventChoice[], hasNext: data.rows.length > 50 };
}
export async function automationLabels(definition: AutomationDefinition): Promise<Labels> {
  const refs = new Map<string, Set<string>>();
  const add = (resource: string, id: string) => refs.set(resource, (refs.get(resource) ?? new Set()).add(id));
  for (const action of definition.actions) for (const ref of actionReferences(action,persistenceRegistry)) add(ref.resource,ref.id);
  for (const c of definition.conditions.children) if (c.kind === 'condition') {
    const field = persistenceRegistry.field('ticket',c.field);
    if (field?.value.kind === 'reference' && c.value !== undefined) for (const id of Array.isArray(c.value) ? c.value : [c.value]) if (typeof id === 'string' && isUuid(id)) add(field.value.resource,id);
  }
  const labels: Labels = {};
  await Promise.all([...refs].map(async ([resource, ids]) => {
    const selected = [...ids];
    for (let start=0;start<selected.length;start+=100) for (const option of (await automationChoices(resource,'',1,selected.slice(start,start+100))).rows) labels[option.id]=option.label;
  }));
  return labels;
}
export async function automationHistory(ruleId: string, page: number) {
  const { viewer, client } = await session(); if (!isUuid(ruleId)) notFound();
  const response = await client.from('automation_executions').select('*').eq('organization_id',viewer.organizationId).eq('rule_id',ruleId).order('started_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*50,page*50);
  if(response.error) throw unavailable();
  const rows=response.data.slice(0,50);
  const steps=rows.length ? await client.from('automation_execution_steps').select('execution_id,status').eq('organization_id',viewer.organizationId).in('execution_id',rows.map(row=>row.id)).limit(1000) : {data:[],error:null};
  if(steps.error) throw unavailable();
  const tickets=rows.length ? await automationChoices('tickets','',1,[...new Set(rows.map(row=>row.entity_id))]) : {rows:[]};
  return { rows, hasNext:response.data.length>50, steps:steps.data ?? [], tickets:Object.fromEntries(tickets.rows.map(row=>[row.id,row.label.split(' · ')[0]])) as Labels };
}
export async function automationExecution(ruleId: string, executionId: string) {
  const {viewer,client}=await session(); if(!isUuid(ruleId)||!isUuid(executionId)) notFound();
  const result=await client.from('automation_executions').select('*').eq('organization_id',viewer.organizationId).eq('rule_id',ruleId).eq('id',executionId).maybeSingle();
  if(result.error) throw unavailable(); if(!result.data) notFound(); const execution: AutomationExecutionRow=result.data;
  const [revision,steps,ticket]=await Promise.all([
    client.from('automation_rule_versions').select('definition').eq('organization_id',viewer.organizationId).eq('rule_id',ruleId).eq('version',execution.rule_version).single(),
    client.from('automation_execution_steps').select('*').eq('organization_id',viewer.organizationId).eq('execution_id',executionId).order('position').limit(20),
    automationChoices('tickets','',1,[execution.entity_id]),
  ]);
  if(revision.error||steps.error) throw unavailable(); const definition=validateDefinition(revision.data.definition,persistenceRegistry); if(!definition.valid) throw unavailable();
  return {execution,steps:steps.data,definition:definition.value,labels:await automationLabels(definition.value),ticketLabel:ticket.rows[0]?.label.split(' · ')[0] ?? 'Ticket unavailable'};
}
export async function automationResultLabels(result: import('./dry-run-model').DryRunResult) {
  const labels: Labels = {};
  for(const condition of result.conditions){
    const field=persistenceRegistry.field('ticket',condition.field);
    if(field?.value.kind!=='reference')continue;
    const selected=[...new Set([condition.expected,condition.actual].flatMap(value=>Array.isArray(value)?value:[value]).filter((value):value is string=>typeof value==='string'&&isUuid(value)))];
    for(let start=0;start<selected.length;start+=100) for(const row of (await automationChoices(field.value.resource,'',1,selected.slice(start,start+100))).rows) labels[row.id]=row.label;
  }
  return labels;
}
