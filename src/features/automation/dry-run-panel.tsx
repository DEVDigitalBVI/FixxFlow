'use client';
import { useEffect, useRef, useState } from 'react';
import { findAutomationEvents, runAutomationTest } from '@/app/app/administration/automations/actions';
import type { AutomationDefinition } from './model';
import type { DryRunResponse, DryRunSource } from './dry-run-model';
import type { EventChoice } from './ui-service';
import { ReferencePicker } from './reference-picker';
import { actionDescription, operatorLabels, triggerLabel, conditionValue, type Choice, type Labels } from './ui-model';
import { presentValidationIssue } from './validation-presentation';
import { ticketPriorities, ticketStatuses, formatTicketDate } from '@/features/tickets/presentation';

export function DryRunPanel({definition,labels,onChoices}:{definition:AutomationDefinition;labels:Labels;onChoices:(rows:Choice[])=>void}) {
  const [ticketId,setTicketId]=useState(''),[kind,setKind]=useState<DryRunSource['kind']>('current_ticket');
  const [eventId,setEventId]=useState(''),[page,setPage]=useState(1),[events,setEvents]=useState<EventChoice[]>([]),[hasNext,setHasNext]=useState(false),[eventsPending,setEventsPending]=useState(false),[eventsError,setEventsError]=useState(''),[refresh,setRefresh]=useState(0);
  const [status,setStatus]=useState(''),[priority,setPriority]=useState('');
  const [busy,setBusy]=useState(false),[result,setResult]=useState<DryRunResponse|null>(null),[testError,setTestError]=useState(''),[resultLabels,setResultLabels]=useState<Labels>({}),[tested,setTested]=useState('');
  const title=useRef<HTMLHeadingElement>(null),feedback=useRef<HTMLDivElement>(null),inFlight=useRef(false);
  useEffect(()=>{title.current?.focus();},[]);
  useEffect(()=>{if(result||testError)feedback.current?.focus();},[result,testError]);
  useEffect(()=>{
    if(!ticketId||kind!=='retained_event')return;
    let cancelled=false;
    findAutomationEvents(ticketId,page).then(response=>{if(cancelled)return;setEventsPending(false);if(!response.ok){setEventsError(response.error);setEvents([]);return;}setEvents(response.value.rows);setHasNext(response.value.hasNext);setEventsError('');}).catch(()=>{if(!cancelled){setEventsPending(false);setEventsError('Ticket events could not load. Try again.');setEvents([]);}});
    return()=>{cancelled=true;};
  },[ticketId,kind,page,refresh]);
  const signature=JSON.stringify({definition,ticketId,kind,eventId,status,priority});const changed=Boolean(result&&tested!==signature);
  const displayLabels={...labels,...resultLabels};
  return <section className="settings-card stack" aria-labelledby="test-heading"><h2 id="test-heading" ref={title} tabIndex={-1}>Test Automation</h2><p className="alert alert-info"><strong>No changes are made by a test.</strong> Check an unsaved draft against a ticket before saving or enabling it.</p>
    <form className="stack" onSubmit={async event=>{
      event.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);setTestError('');
      const source:DryRunSource=kind==='current_ticket'?{kind}:kind==='retained_event'?{kind,eventId}:{kind,after:{...(status?{status}:{}),...(priority?{priority}:{})}};
      try{const response=await runAutomationTest({ticketId,definition:{kind:'draft',value:definition},source});setResult(response.result);setResultLabels(response.labels);setTested(signature);}
      catch{setTestError('The test could not finish. No changes were made. Try again.');}finally{inFlight.current=false;setBusy(false);}
    }}><fieldset className="action-form-fields" disabled={busy}>
      <ReferencePicker resource="tickets" value={ticketId} onChange={value=>{setTicketId(String(value));setEventsPending(true);setEventId('');setEvents([]);setPage(1);}} label="Ticket to test" onChoices={onChoices}/>
      <div className="field"><label htmlFor="test-context">Test context</label><select id="test-context" className="input" value={kind} onChange={event=>{setKind(event.target.value as DryRunSource['kind']);setEventsPending(true);}}><option value="current_ticket">Current ticket · hypothetical creation</option><option value="retained_event">Retained ticket event</option><option value="simulated_transition">Simulated status or priority change</option></select></div>
      {kind==='current_ticket'&&<p className="alert alert-info">Uses current values as a hypothetical new ticket. This does not describe what happened when the ticket was originally created.</p>}
      {kind==='retained_event'&&<div className="stack"><p className="muted">Choose a recorded event. Older values may differ from the ticket today.</p><div className="field"><label htmlFor="test-event">Recorded event</label><select id="test-event" className="input" value={eventId} onChange={event=>setEventId(event.target.value)} required><option value="">Choose an event</option>{events.map(item=><option value={item.id} key={item.id}>{triggerLabel(item.event_type)} · {formatTicketDate(item.occurred_at)} · revision {item.entity_version}</option>)}</select></div>{(!events.length||eventsPending)&&<p role="status">{!ticketId?'Select a ticket first.':eventsPending?'Loading recorded events…':eventsError||'No recorded events on this page. Choose a current or simulated context instead.'}</p>}<div className="automation-inline">{eventsError&&<button type="button" className="button button-secondary" onClick={()=>{setEventsPending(true);setRefresh(value=>value+1);}}>Retry events</button>}{page>1&&<button type="button" className="button button-quiet" onClick={()=>{setEventsPending(true);setPage(page-1);setEventId('');}}>Previous events</button>}{hasNext&&<button type="button" className="button button-quiet" onClick={()=>{setEventsPending(true);setPage(page+1);setEventId('');}}>More events</button>}</div></div>}
      {kind==='simulated_transition'&&<div className="stack"><p className="alert alert-info"><strong>Simulated.</strong> Current values are the starting point. Choose at least one hypothetical new value; no transition will occur.</p><div className="automation-action-grid"><div className="field"><label htmlFor="simulate-status">Simulated status</label><select id="simulate-status" className="input" value={status} onChange={event=>setStatus(event.target.value)}><option value="">Keep current status</option>{Object.entries(ticketStatuses).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select></div><div className="field"><label htmlFor="simulate-priority">Simulated priority</label><select id="simulate-priority" className="input" value={priority} onChange={event=>setPriority(event.target.value)}><option value="">Keep current priority</option>{Object.entries(ticketPriorities).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select></div></div></div>}
      <button className="button button-secondary" type="submit" disabled={busy||!ticketId}>{busy?'Testing…':'Test Automation'}</button>
    </fieldset></form>
    {(result||testError)&&<div className="stack automation-test-result" ref={feedback} tabIndex={-1} aria-label="Automation test result"><h3>Test result</h3><p className="alert alert-info"><strong>No changes were made.</strong></p>
      {changed&&<p className="alert alert-info">The draft or test context changed after this test. Test again for an up-to-date result.</p>}
      {testError&&<p className="alert alert-error" role="alert">{testError}</p>}
      {result&&!result.ok&&<p className="alert alert-error">{result.error.message} {result.error.issues?.map(issue=>presentValidationIssue(definition,issue).message).join(' ')}</p>}
      {result?.ok&&<DryRunResultView result={result.value} labels={displayLabels}/>}
    </div>}
  </section>;
}
export function DryRunResultView({result,labels}:{result:Extract<DryRunResponse,{ok:true}>['value'];labels:Labels}) {
  return <><p><strong>Ticket #{result.context.ticketNumber}</strong> · evaluated revision {result.context.evaluatedRevision} · current revision {result.context.currentRevision}</p>
    {result.context.source==='simulated_transition'&&<p className="alert alert-info"><strong>Simulated values.</strong> This transition did not occur.</p>}
    {result.context.source==='retained_event'&&<p className="badge">Retained historical event</p>}
    {result.context.source==='current_ticket'&&<p className="muted">Hypothetical creation using current ticket values.</p>}
    {result.context.differsFromCurrent&&<p className="alert alert-info">The ticket has changed since this recorded event. Historical matching does not authorize changes to the current ticket.</p>}
    <h4>Trigger</h4><p>{result.trigger.compatible?'✓ Compatible':'— Not compatible'} · {result.trigger.explanation}</p>
    <h4>Conditions</h4>{!result.conditions.length?<p>No conditions configured.</p>:<ul className="automation-results">{result.conditions.map(item=><li key={item.id}><strong>{item.status==='passed'?'✓ Passed':item.status==='failed'?'✕ Not met':item.status==='error'?'Could not evaluate':'Not evaluated'}</strong> · {item.label} {operatorLabels[item.operator]} {item.expected!==undefined?conditionValue(item.field,item.expected,labels):''}{item.status!=='passed'&&<p className="muted">Actual: {item.actualRedacted?'Not displayed':conditionValue(item.field,item.actual,labels)}</p>}</li>)}</ul>}
    <h4>Proposed actions</h4>{!result.actions.length?<p>No actions proposed. The automation would not run for this context.</p>:<ol className="automation-results">{result.actions.map(item=><li key={item.id}><strong>{actionDescription(item,labels)}</strong><p>{item.validation==='valid'?'✓ Current validation passed':item.validation==='invalid'?'✕ Would fail validation':'— Would not execute'} · {item.explanation}</p></li>)}</ol>}
    {Boolean(result.warnings?.length)&&<section aria-label="Test warnings"><h4>Warnings</h4><ul className="automation-results">{result.warnings.map((warning,index)=><li key={index}>{warning.startsWith('This evaluates a definition')?'This test checks matching and current selections. Future runs still require an enabled rule, eligible events and active processing; success is not guaranteed.':warning.startsWith('Current ticket state differs')?'The ticket has changed since this event. This test does not allow an old event to run again.':warning}</li>)}</ul></section>}
    {!result.currentReferencesValid&&<p className="alert alert-info">One or more referenced people, teams or categories are unavailable. Review the selections.</p>}
    <p><strong>{result.wouldProceed?'This draft matches and its current checks pass.':'This draft does not pass all checks for the selected context.'}</strong> A test does not enable or run the automation.</p>
  </>;
}
