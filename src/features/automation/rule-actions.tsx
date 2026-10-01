import Link from 'next/link';
import type { AutomationDefinition } from './model';
import { automationPath, triggerLabel, type Labels } from './ui-model';
import { automationSummary } from './summary';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { manageAutomation } from '@/app/app/administration/automations/actions';
import { ExportAutomationButton } from './export-button';

export function RuleActions({id,name,version,enabled,archived=false,definition,labels={},processingActive=false}:{id:string;name:string;version:number;enabled:boolean;archived?:boolean;definition?:AutomationDefinition;labels?:Labels;processingActive?:boolean}) {
  const hidden=(operation:string)=><><input type="hidden" name="id" value={id}/><input type="hidden" name="version" value={version}/><input type="hidden" name="operation" value={operation}/></>;
  return <div className="automation-inline">
    <ExportAutomationButton id={id} name={name}/>
    {!archived&&!enabled&&!definition&&<Link className="button button-quiet" href={`${automationPath}/${id}#rule-controls`}>Review and enable<span className="sr-only"> {name}</span></Link>}
    {!archived&&(enabled||definition)&&<details className="settings-editor"><summary>{enabled?'Disable':'Enable'}<span className="sr-only"> {name}</span></summary><ActionForm action={manageAutomation} className="stack">{hidden(enabled?'disable':'enable')}<p>{enabled?'Stop this rule from starting new work.':`Enable “${name}”? Future eligible events may cause its actions to run automatically.`}</p>{!enabled&&definition&&<><p><strong>{triggerLabel(definition.trigger.type)}</strong> · Version {version}</p><p className="automation-summary">{automationSummary(definition,labels)}</p>{!processingActive&&<p className="alert alert-info">This rule will be enabled, but Automation processing is currently disabled. It will not execute until processing is activated.</p>}</>}{!enabled&&<label className="check-field"><input type="checkbox" name="confirmation" value={id} required/>Enable “{name}”</label>}<SubmitButton className="button button-secondary">{enabled?'Disable rule':'Enable rule'}</SubmitButton></ActionForm></details>}
    {!archived&&<details className="settings-editor"><summary>Duplicate<span className="sr-only"> {name}</span></summary><ActionForm action={manageAutomation} className="stack">{hidden('duplicate')}<div className="field"><label htmlFor={`copy-${id}`}>Name for the disabled copy</label><input id={`copy-${id}`} className="input" name="name" defaultValue={`${name.slice(0,113)} (copy)`} required maxLength={120}/></div><SubmitButton className="button button-secondary">Create disabled copy</SubmitButton></ActionForm></details>}
    {!archived&&<details className="settings-editor"><summary>Archive<span className="sr-only"> {name}</span>…</summary><ActionForm action={manageAutomation} className="stack">{hidden('archive')}<p id={`archive-${id}`}>Archive “{name}”? Archiving stops this automation from being used for future processing. Historical versions and execution history are retained.</p><label className="check-field"><input type="checkbox" name="confirmation" value={id} required aria-describedby={`archive-${id}`}/>I confirm archiving {name}.</label><SubmitButton className="button button-danger" pendingLabel="Archiving…">Archive automation</SubmitButton><p className="muted">Close this section to cancel.</p></ActionForm></details>}
  </div>;
}
