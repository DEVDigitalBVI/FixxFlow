'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveAutomationDraft } from '@/app/app/administration/automations/actions';
import type { PersistedAutomationRule } from './persistence-model';
import type { AutomationAction, AutomationCondition, AutomationDefinition, ValidationIssue } from './model';
import { persistenceRegistry } from './persistence-contract';
import { validateDefinition } from './validation';
import { operatorsFor } from './registries';
import { actionOptions, actionLabel, automationPath, fieldOptions, moveAction, newAction, newCondition, newDefinition, operatorLabels, triggerOptions, type Choice, type Labels } from './ui-model';
import { ValueControl } from './value-control';
import { DryRunPanel } from './dry-run-panel';

export function AutomationBuilder({initial,initialLabels={}}:{initial?:PersistedAutomationRule;initialLabels?:Labels}) {
  const router=useRouter();const [definition,setDefinition]=useState<AutomationDefinition>(initial?.rule.definition??newDefinition());
  const [saved,setSaved]=useState(JSON.stringify(initial?.rule.definition??newDefinition()));
  const [identity,setIdentity]=useState(initial?{id:initial.rule.id,version:initial.rule.version}:null);
  const [issues,setIssues]=useState<readonly ValidationIssue[]>([]),[announcement,setAnnouncement]=useState('');
  const [labels,setLabels]=useState<Labels>(initialLabels);const [testing,setTesting]=useState(false);
  const focus=useRef<string|null>(null);const root=useRef<HTMLDivElement>(null);
  const dirty=JSON.stringify(definition)!==saved;
  const choices=useCallback((rows:Choice[])=>setLabels(previous=>({...previous,...Object.fromEntries(rows.map(row=>[row.id,row.label]))})),[]);
  useLayoutEffect(()=>{if(focus.current){document.getElementById(focus.current)?.focus();focus.current=null;}},[definition]);
  useEffect(()=>{
    if(!dirty)return;
    const unload=(event:BeforeUnloadEvent)=>event.preventDefault();
    const navigate=(event:MouseEvent)=>{const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;if(link && link.target!=='_blank' && !event.metaKey && !event.ctrlKey && !link.hash && !window.confirm('Discard unsaved automation changes?'))event.preventDefault();};
    window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);};
  },[dirty]);
  const change=(value:AutomationDefinition)=>{setDefinition(value);setIssues([]);};
  const editCondition=(index:number,value:AutomationCondition)=>change({...definition,conditions:{...definition.conditions,children:definition.conditions.children.map((item,i)=>i===index?value:item)}});
  const editAction=(index:number,value:AutomationAction)=>change({...definition,actions:definition.actions.map((item,i)=>i===index?value:item)});
  const errors=(path:string)=>issues.filter(issue=>issue.path===path||issue.path.startsWith(`${path}.`));
  const messages=(path:string,id:string)=>errors(path).length?<p id={id} className="alert alert-error">{errors(path).map(issue=>issue.message).join(' ')}</p>:null;
  return <div ref={root} className="stack">
    <ActionForm className="stack" action={async()=>{
      const valid=validateDefinition(definition,persistenceRegistry);
      if(!valid.valid){setIssues(valid.issues);return {error:'Check the highlighted fields. Your draft is preserved.'};}
      const result=await saveAutomationDraft(identity?.id??null,identity?.version??null,valid.value);
      if(!result.ok){setIssues(result.error.issues??[]);return {error:result.error.code==='conflict'?'Another administrator changed this automation. Your draft is preserved. Open the saved version in a new tab to compare before reloading.':result.error.message};}
      setIdentity({id:result.value.rule.id,version:result.value.rule.version});setSaved(JSON.stringify(result.value.rule.definition));setDefinition(result.value.rule.definition);setIssues([]);
      if(!identity)router.replace(`${automationPath}/${result.value.rule.id}`);
      return {success:identity?'Changes saved. Rule enablement was not changed.':'Automation saved as disabled. Enable it separately when ready.'};
    }}>
      <section className="settings-card stack" aria-labelledby="automation-name-heading"><h2 id="automation-name-heading">Automation details</h2>
        <div className="field"><label htmlFor="automation-name">Name</label><input id="automation-name" className="input" value={definition.name} maxLength={120} aria-invalid={errors('name').length>0||undefined} aria-describedby={errors('name').length?'automation-name-error':undefined} onChange={event=>change({...definition,name:event.target.value})}/>{messages('name','automation-name-error')}</div>
        <div className="field"><label htmlFor="automation-description">Description <span className="muted">(optional)</span></label><textarea id="automation-description" className="input" rows={2} maxLength={2000} value={definition.description??''} onChange={event=>change({...definition,description:event.target.value||null})}/></div>
      </section>
      <section className="settings-card stack" aria-labelledby="when-heading"><h2 id="when-heading">When</h2><p className="muted">Choose the ticket event that starts this automation.</p><div className="field"><label htmlFor="automation-trigger">Ticket event</label><select id="automation-trigger" className="input" value={definition.trigger.type} onChange={event=>change({...definition,trigger:{type:event.target.value,configuration:{}}})}>{triggerOptions.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></div></section>
      <section className="settings-card stack" aria-labelledby="if-heading"><h2 id="if-heading">If</h2><p className="muted">All conditions must match. With no conditions, every compatible ticket matches.</p>
        {definition.conditions.children.map((item,index)=>{if(item.kind!=='condition')return null;const spec=fieldOptions.find(field=>field.key===item.field)!;const path=`conditions.children.${index}`,errorId=`condition-error-${item.id}`;
          const parent=definition.conditions.children.find(c=>c.kind==='condition'&&c.field==='category_id'&&c.operator==='equals');
          return <fieldset className="automation-row" key={item.id} aria-describedby={errors(path).length?errorId:undefined}><legend>Condition {index+1}</legend><div className="automation-condition-grid">
            <div className="field"><label htmlFor={`condition-${item.id}`}>Field</label><select id={`condition-${item.id}`} className="input" value={item.field} onChange={event=>editCondition(index,newCondition(item.id,event.target.value))}>{fieldOptions.map(field=><option key={field.key} value={field.key}>{field.label}</option>)}</select></div>
            <div className="field"><label htmlFor={`operator-${item.id}`}>Comparison</label><select id={`operator-${item.id}`} className="input" value={item.operator} onChange={event=>editCondition(index,newCondition(item.id,item.field,event.target.value as AutomationCondition['operator']))}>{operatorsFor(spec).map(operator=><option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select></div>
            {!['is_empty','is_not_empty'].includes(item.operator)&&<ValueControl schema={spec.value} label="Value" value={item.value} multiple={['in','not_in'].includes(item.operator)} onChange={value=>editCondition(index,{...item,value})} invalid={errors(path).length>0} describedBy={errors(path).length?errorId:undefined} parentId={item.field==='subcategory_id'&&parent?.kind==='condition'?String(parent.value):undefined} onChoices={choices}/>}
          </div>{messages(path,errorId)}<button type="button" className="button button-quiet" aria-label={`Remove condition ${index+1}`} onClick={()=>{focus.current='add-condition';change({...definition,conditions:{...definition.conditions,children:definition.conditions.children.filter(c=>c.id!==item.id)}});setAnnouncement(`Condition ${index+1} removed.`);}}>Remove condition</button></fieldset>;
        })}
        {messages('conditions','conditions-error')}<button id="add-condition" type="button" className="button button-secondary" disabled={definition.conditions.children.length>=50} onClick={()=>{const item=newCondition(crypto.randomUUID());focus.current=`condition-${item.id}`;change({...definition,conditions:{...definition.conditions,children:[...definition.conditions.children,item]}});}}>+ Add condition</button>
      </section>
      <section className="settings-card stack" aria-labelledby="then-heading"><h2 id="then-heading">Then</h2><p className="muted">Actions run in order. If an action fails, the remaining actions stop.</p>
        {definition.actions.map((item,index)=>{const path=`actions.${index}`,errorId=`action-error-${item.id}`,spec=actionOptions.find(a=>a.key===item.type)!;return <fieldset key={item.id} className="automation-row" aria-describedby={errors(path).length?errorId:undefined}><legend>Action {index+1}</legend>
          <div className="automation-action-grid"><div className="field"><label htmlFor={`action-${item.id}`}>Action</label><select id={`action-${item.id}`} className="input" value={item.type} onChange={event=>editAction(index,newAction(item.id,index,event.target.value))}>{actionOptions.map(action=><option key={action.key} value={action.key}>{action.label}</option>)}</select></div>
          {Object.entries(spec.configuration).filter(([key])=>key!=='template').map(([key,property])=>key==='body'?<div className="field" key={key}><label htmlFor={`note-${item.id}`}>Internal note</label><textarea id={`note-${item.id}`} className="input" rows={4} maxLength={20000} aria-invalid={errors(path).length>0||undefined} aria-describedby={errors(path).length?errorId:undefined} value={String(item.configuration.body??'')} onChange={event=>editAction(index,{...item,configuration:{body:event.target.value}})}/></div>:<ValueControl key={key} schema={property.value} label={({technicianId:'Technician',teamId:'Team',categoryId:'Category',priority:'Priority',status:'Status',recipient:'Recipient'} as Record<string,string>)[key]??'Value'} value={item.configuration[key]} activeOnly onChange={value=>editAction(index,{...item,configuration:{...item.configuration,[key]:value}})} onChoices={choices} invalid={errors(path).length>0} describedBy={errors(path).length?errorId:undefined}/>)}</div>
          {item.type==='set_category'&&<p className="muted">Changing the category clears an existing subcategory. Setting a subcategory is not available.</p>}{item.type==='send_notification'&&<p className="muted">Sends the standard ticket update to the requester or assigned technician.</p>}{messages(path,errorId)}
          <div className="automation-inline">{([-1,1] as const).map(direction=><button key={direction} type="button" className="button button-secondary" disabled={direction===-1?index===0:index===definition.actions.length-1} aria-label={`Move action ${index+1} ${direction===-1?'up':'down'}`} onClick={()=>{focus.current=`action-${item.id}`;change({...definition,actions:moveAction(definition.actions,item.id,direction)});setAnnouncement(`Moved ${actionLabel(item.type)} to position ${index+1+direction}.`);}}>{direction===-1?'Move Up':'Move Down'}</button>)}<button type="button" className="button button-quiet" onClick={()=>{focus.current='add-action';change({...definition,actions:definition.actions.filter(a=>a.id!==item.id).map((a,position)=>({...a,position}))});setAnnouncement(`Action ${index+1} removed.`);}} aria-label={`Remove action ${index+1}`}>Remove action</button></div>
        </fieldset>;})}
        {messages('actions','actions-error')}<button id="add-action" type="button" className="button button-secondary" disabled={definition.actions.length>=20} onClick={()=>{const item=newAction(crypto.randomUUID(),definition.actions.length);focus.current=`action-${item.id}`;change({...definition,actions:[...definition.actions,item]});}}>+ Add action</button>
      </section>
      <div className="automation-inline"><SubmitButton className="button button-primary">{identity?'Save changes':'Save as disabled'}</SubmitButton><button className="button button-secondary" type="button" onClick={()=>setTesting(true)}>Test Automation</button><button className="button button-quiet" type="button" onClick={()=>{if(!dirty||window.confirm('Discard unsaved automation changes?'))router.push(automationPath);}}>Cancel</button><span className="muted">{dirty?'Unsaved changes':identity?`Saved · version ${identity.version}`:'New automation · disabled'}</span></div>
    </ActionForm>
    {identity&&<a className="button button-quiet" href={`${automationPath}/${identity.id}`} target="_blank" rel="noreferrer">View saved version in a new tab</a>}
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    {testing&&<DryRunPanel definition={definition} labels={labels} onChoices={choices}/>}
  </div>;
}
