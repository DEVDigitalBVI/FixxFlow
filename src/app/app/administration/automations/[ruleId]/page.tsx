import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutomationBuilder } from '@/features/automation/builder';
import { AutomationHeader } from '@/features/automation/page-parts';
import { RuleActions } from '@/features/automation/rule-actions';
import { getAutomation } from '@/features/automation/admin-service';
import { automationLabels, automationProcessingActive, requireAutomationAdmin } from '@/features/automation/ui-service';
import { automationPath } from '@/features/automation/ui-model';
export default async function EditAutomationPage({params,searchParams}:{params:Promise<{ruleId:string}>;searchParams:Promise<{saved?:string}>}) {
  await requireAutomationAdmin(); const {ruleId}=await params;const result=await getAutomation(ruleId);
  if(!result.ok){if(['not_found','invalid_input','forbidden'].includes(result.error.code))notFound();throw Error('Automation could not load.');}
  const {rule,archivedAt}=result.value;
  const [labels,processingActive,query]=await Promise.all([automationLabels(rule.definition),automationProcessingActive(),searchParams]);
  return <><AutomationHeader title={rule.definition.name} description={`Version ${rule.version} · ${archivedAt?'Archived':rule.enabled?'Enabled':'Disabled'}`}/><div id="rule-controls" className="automation-inline"><Link className="button button-secondary" href={`${automationPath}/${rule.id}/history`}>View History</Link><RuleActions id={rule.id} name={rule.definition.name} version={rule.version} enabled={rule.enabled} archived={Boolean(archivedAt)} definition={rule.definition} labels={labels} processingActive={processingActive}/></div>{query?.saved==='disabled'&&!rule.enabled&&!archivedAt&&<p className="alert alert-success" role="status">Automation saved. It will not run until enabled. Global processing must also be active.</p>}{archivedAt?<section className="settings-card"><h2>Archived automation</h2><p>This automation cannot run or be edited. Its versions and execution history are retained.</p></section>:<AutomationBuilder initial={result.value} initialLabels={labels}/>}</>;
}
