import Link from 'next/link';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { automationList } from '@/features/automation/ui-service';
import { automationPath, executionLabel, triggerLabel, triggerOptions } from '@/features/automation/ui-model';
import { AutomationHeader, AutomationPages } from '@/features/automation/page-parts';
import { AutomationListEmptyState } from '@/features/automation/list-empty-state';
import { RuleActions } from '@/features/automation/rule-actions';
import { formatTicketDate } from '@/features/tickets/presentation';
import { normalizeSearch } from '@/lib/search';
import { pageNumber } from '@/lib/pagination';

export default async function AutomationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const filters=await searchParams,page=pageNumber(filters.page),query=normalizeSearch(filters.q),state=typeof filters.state==='string'?filters.state:'all',trigger=typeof filters.trigger==='string'?filters.trigger:'';
  const data=await automationList(query,state,trigger,page),filtered=Boolean(query||trigger||state!=='all'||page>1);
  const emptyTitle=query?'No automations match your search':filtered?'No automations match these filters':'Automate repetitive ticket work';
  const emptyDescription=query?'Try another name or clear your search and filters.':filtered?'Change the status or trigger, or clear your filters.':'Route requests, set priorities and keep your team informed. Choose when a rule starts, what it checks and what happens next.';
  const href=(page:number)=>`${automationPath}?${new URLSearchParams({q:query,state,trigger,page:String(page)})}`;
  return <>
    <AutomationHeader title="Automations" description="Less repetitive work. More time for the tickets that need you." back="/app/administration" actions={<>
      <Link href={`${automationPath}/import`} className="button button-secondary">Import Automation</Link>
      <Link href={`${automationPath}/operations`} className="button button-secondary">Operations</Link>
      <Link href={`${automationPath}/new`} className="button button-primary"><span aria-hidden="true">＋</span>Create Automation</Link>
    </>}/>
    <section className="automation-collection" aria-labelledby="automation-collection-heading">
      <header className="automation-collection-heading">
        <div><h2 id="automation-collection-heading">Your automations</h2><p>{data.rows.length ? `${data.rows.length} ${data.rows.length===1?'automation':'automations'} on this page` : 'Build, test and manage your ticket workflows.'}</p></div>
        <div className="automation-inline"><span className={`badge ${data.processingActive?'badge-active':'badge-inactive'}`}>{data.processingActive?'Processing active':'Processing off'}</span><Link className="button button-secondary" href={`${automationPath}/operations/history`}>Execution history</Link></div>
      </header>
      <div className="automation-collection-toolbar">
        <LiveSearchForm action={automationPath} label="Search automations" className="automation-filters" resultSummary={`${data.rows.length} automations on this page.`}>
          <div className="field"><label htmlFor="automation-search">Search by name</label><input id="automation-search" name="q" type="search" className="input" placeholder="Find an automation…" defaultValue={query}/></div>
          <div className="field"><label htmlFor="automation-state">Status</label><select id="automation-state" name="state" className="input" defaultValue={state}><option value="all">All current rules</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="archived">Archived</option></select></div>
          <div className="field"><label htmlFor="automation-filter-trigger">Trigger</label><select id="automation-filter-trigger" name="trigger" className="input" defaultValue={trigger}><option value="">All triggers</option>{triggerOptions.map(item=><option value={item.key} key={item.key}>{item.label}</option>)}</select></div>
          <button className="button button-secondary" type="submit">Search</button>{filtered&&<Link className="button button-quiet" href={automationPath}>Clear filters</Link>}
        </LiveSearchForm>
      </div>
      {!data.rows.length?<AutomationListEmptyState filtered={filtered} title={emptyTitle} description={emptyDescription}/>:<div className="table-region automation-list-region" role="region" aria-label="Automation rules" tabIndex={0}>
        <table className="table responsive-table automation-list-table">
          <caption className="sr-only">Automation rules and recent activity</caption>
          <thead><tr>{['Automation','Status','Activity','Updated','Actions'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{data.rows.map(row=><tr key={row.id}>
            <th scope="row" data-label="Automation"><div className="automation-list-identity"><strong>{row.name}</strong><span>{triggerLabel(row.trigger_type)}</span></div></th>
            <td data-label="Status"><span className={`badge ${!row.archived_at&&row.enabled?'badge-active':'badge-inactive'}`}>{row.archived_at?'Archived':row.enabled?'Enabled':'Disabled'}</span></td>
            <td data-label="Activity"><div className="automation-list-activity"><strong>{row.last_run?executionLabel(row.last_run.status,row.last_run.error_code):'Not run yet'}</strong><span>{row.last_run?<>Last run <time dateTime={row.last_run.started_at}>{formatTicketDate(row.last_run.started_at)}</time></>:'No execution history'}</span><span>Run count: {row.run_count}</span></div></td>
            <td data-label="Updated"><time dateTime={row.updated_at}>{formatTicketDate(row.updated_at)}</time></td>
            <td data-label="Actions" className="automation-list-actions">
              <div className="automation-inline"><Link className="button button-secondary" href={`${automationPath}/${row.id}`}>{row.archived_at?'View':'Edit'}<span className="sr-only"> {row.name}</span></Link><Link className="button button-secondary" href={`${automationPath}/${row.id}/history`}>History<span className="sr-only"> for {row.name}</span></Link></div>
              {!row.archived_at&&<details className="automation-list-manage"><summary className="button button-quiet">Manage<span className="sr-only"> {row.name}</span><span aria-hidden="true">⌄</span></summary><RuleActions id={row.id} name={row.name} version={row.version} enabled={row.enabled} processingActive={data.processingActive}/></details>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
      {(data.rows.length>0||page>1)&&<footer className="automation-collection-footer"><AutomationPages page={page} hasNext={data.hasNext} href={href}/></footer>}
    </section>
  </>;
}
