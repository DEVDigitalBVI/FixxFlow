import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAutomation } from '@/features/automation/admin-service';
import { automationHistory, requireAutomationAdmin } from '@/features/automation/ui-service';
import { automationPath, executionLabel, executionDuration, triggerLabel } from '@/features/automation/ui-model';
import { AutomationHeader, AutomationPages } from '@/features/automation/page-parts';
import { pageNumber } from '@/lib/pagination';
import { formatTicketDate } from '@/features/tickets/presentation';
export default async function HistoryPage({params,searchParams}:{params:Promise<{ruleId:string}>;searchParams:Promise<{page?:string}>}){
  await requireAutomationAdmin();const {ruleId}=await params;const rule=await getAutomation(ruleId);if(!rule.ok){if(rule.error.code==='not_found'||rule.error.code==='invalid_input')notFound();throw Error('History could not load.');}
  const page=pageNumber((await searchParams).page),data=await automationHistory(ruleId,page);
  return <><AutomationHeader title={`${rule.value.rule.definition.name} · History`} description="Each run keeps the exact version it used."/><Link href={`${automationPath}/${ruleId}`}>Back to automation</Link>
    {!data.rows.length?<section className="settings-card automation-empty"><h2>No executions on this page</h2><p>Eligible runs will appear here after processing is activated. Tests do not create execution history.</p></section>:<div className="table-region" role="region" aria-label="Automation execution history" tabIndex={0}><table className="table responsive-table"><caption className="sr-only">Execution time, immutable version and action completion</caption><thead><tr>{['Started','Version','Trigger','Ticket','Result','Duration','Actions'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.rows.map(row=>{const steps=data.steps.filter(step=>step.execution_id===row.id);return <tr key={row.id}><th scope="row" data-label="Started"><Link href={`${automationPath}/${ruleId}/history/${row.id}`}><time dateTime={row.started_at}>{formatTicketDate(row.started_at)}</time></Link></th><td data-label="Version">Version {row.rule_version}</td><td data-label="Trigger">{triggerLabel(row.trigger_type)}</td><td data-label="Ticket"><Link href={`/app/tickets/${row.entity_id}`}>{data.tickets[row.entity_id]??'Ticket unavailable'}</Link></td><td data-label="Result">{executionLabel(row.status,row.error_code)}</td><td data-label="Duration">{executionDuration(row.duration_ms,row.status)}</td><td data-label="Actions">{steps.filter(step=>step.status==='succeeded').length} of {steps.length} completed</td></tr>;})}</tbody></table></div>}
    <AutomationPages page={page} hasNext={data.hasNext} href={page=>`${automationPath}/${ruleId}/history?page=${page}`}/>
  </>;
}
