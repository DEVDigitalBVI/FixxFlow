import Link from 'next/link';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { automationList } from '@/features/automation/ui-service';
import { automationPath, executionLabel, triggerLabel, triggerOptions } from '@/features/automation/ui-model';
import { AutomationHeader, AutomationPages } from '@/features/automation/page-parts';
import { RuleActions } from '@/features/automation/rule-actions';
import { formatTicketDate } from '@/features/tickets/presentation';
import { normalizeSearch } from '@/lib/search';
import { pageNumber } from '@/lib/pagination';
export default async function AutomationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const filters=await searchParams,page=pageNumber(filters.page),query=normalizeSearch(filters.q),state=typeof filters.state==='string'?filters.state:'all',trigger=typeof filters.trigger==='string'?filters.trigger:'';
  const data=await automationList(query,state,trigger,page),filtered=Boolean(query||trigger||state!=='all'||page>1);
  const emptyTitle=query?'No automations match your search':filtered?'No automations match these filters':'Automate repetitive ticket work';
  const emptyDescription=query?'Try another name or clear your search and filters.':filtered?'Change the status or trigger, or clear your filters.':'Route tickets, update priorities, assign technicians and perform other actions automatically when your conditions match. Start with a template or build your own.';
  const href=(page:number)=>`${automationPath}?${new URLSearchParams({q:query,state,trigger,page:String(page)})}`;
  return <><AutomationHeader title="Automations" description="Turn repeatable ticket work into clear, ordered rules." back="/app/administration"/><div className="automation-inline"><Link href={`${automationPath}/new`} className="button button-primary">Create Automation</Link><span className="muted">{data.processingActive?'Processing active':'Processing off · rules can still be managed and tested'}</span></div>
    <LiveSearchForm action={automationPath} label="Search automations" className="automation-filters" resultSummary={`${data.rows.length} automations on this page.`}>
      <div className="field"><label htmlFor="automation-search">Search by name</label><input id="automation-search" name="q" type="search" className="input" defaultValue={query}/></div>
      <div className="field"><label htmlFor="automation-state">Status</label><select id="automation-state" name="state" className="input" defaultValue={state}><option value="all">All current rules</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="archived">Archived</option></select></div>
      <div className="field"><label htmlFor="automation-filter-trigger">Trigger</label><select id="automation-filter-trigger" name="trigger" className="input" defaultValue={trigger}><option value="">All ticket events</option>{triggerOptions.map(item=><option value={item.key} key={item.key}>{item.label}</option>)}</select></div>
      <button className="button button-secondary" type="submit">Search</button>{filtered&&<Link className="button button-quiet" href={automationPath}>Clear filters</Link>}
    </LiveSearchForm>
    {!data.rows.length?<section className="settings-card automation-empty"><h2>{emptyTitle}</h2><p>{emptyDescription}</p><Link className="button button-secondary" href={filtered?automationPath:`${automationPath}/new`}>{filtered?'Clear filters':'Create Automation'}</Link></section>:<div className="table-region" role="region" aria-label="Automation rules" tabIndex={0}><table className="table responsive-table"><caption className="sr-only">Automation rules and recent activity</caption><thead><tr>{['Name','Status','Trigger','Last run','Run count','Recent result','Updated','Actions'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><th scope="row" data-label="Name"><Link href={`${automationPath}/${row.id}`}>{row.name}</Link></th><td data-label="Status"><span className="badge">{row.archived_at?'Archived':row.enabled?'Enabled':'Disabled'}</span></td><td data-label="Trigger">{triggerLabel(row.trigger_type)}</td><td data-label="Last run">{row.last_run?formatTicketDate(row.last_run.started_at):'Never'}</td><td data-label="Run count">{row.run_count}</td><td data-label="Recent result">{row.last_run?executionLabel(row.last_run.status,row.last_run.error_code):'Not run'}</td><td data-label="Updated">{formatTicketDate(row.updated_at)}</td><td data-label="Actions"><div className="automation-inline"><Link href={`${automationPath}/${row.id}`}>{row.archived_at?'View':'Edit'}</Link><Link href={`${automationPath}/${row.id}/history`}>History</Link></div><RuleActions id={row.id} name={row.name} version={row.version} enabled={row.enabled} archived={Boolean(row.archived_at)}/></td></tr>)}</tbody></table></div>}
    <AutomationPages page={page} hasNext={data.hasNext} href={href}/>
  </>;
}
