import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireViewer } from '@/lib/auth/viewer';
import { CustomReportBuilder } from '@/features/reporting/custom-builder';
import { CustomReportResults, ReportOutputActions, SaveReportPanel } from '@/features/reporting/custom-components';
import { dateInTimezone, defaultReportDefinition, definitionFromInput, definitionToQuery, reportTemplates } from '@/features/reporting/custom-model';
import { getCustomReport, getReportReferences, getSavedReport } from '@/features/reporting/custom-data';

type Params=Record<string,string|string[]|undefined>;
function queryFrom(params:Params){const query=new URLSearchParams();for(const [key,value] of Object.entries(params))for(const item of Array.isArray(value)?value:value?[value]:[])query.append(key,item);return query;}
export default async function CustomReportPage({searchParams}:{searchParams:Promise<Params>}){
  const viewer=await requireViewer();if(viewer.role==='end_user')notFound();
  const params=await searchParams,query=queryFrom(params),savedId=typeof params.saved==='string'?params.saved:null;
  const saved=savedId?await getSavedReport(viewer.organizationId,savedId):null;if(savedId&&!saved)notFound();
  const fallback=saved?.definition??defaultReportDefinition(dateInTimezone(viewer.organizationTimezone));
  const hasDefinition=query.has('metrics')||query.has('reportType');const parsed=hasDefinition?definitionFromInput(query,fallback):fallback;const definition=parsed??fallback;
  const [references,report]=await Promise.all([getReportReferences(viewer.organizationId),getCustomReport(viewer.organizationId,definition)]);
  const canEdit=!saved||saved.owner_id===viewer.id||viewer.role==='administrator';
  return <div className="page reports-page custom-report-page"><PageHeader back={{href:saved?`/app/reports/saved/${saved.id}`:'/app/reports',label:saved?'Back to saved report':'Back to reports'}} eyebrow={viewer.organizationName} title={saved?`Edit ${saved.name}`:'Create custom report'} description="Choose a business question, period, measures and filters. Results refresh from live ticket data." actions={<Link className="button button-secondary" href="/app/reports">Report overview</Link>}/>
    {!saved&&<section aria-labelledby="report-templates-title"><header className="overview-section-heading"><div><h2 id="report-templates-title">Start with a template</h2><p>Use a proven definition, then adjust only what matters.</p></div></header><div className="report-template-grid">{reportTemplates.map(template=>{const item=defaultReportDefinition(dateInTimezone(viewer.organizationTimezone),template.type);item.groupBy=template.groupBy;item.metrics=template.metrics;return <Link className="settings-card report-template-card" href={`/app/reports/custom?${definitionToQuery(item)}#report-builder`} key={template.name}><strong>{template.name}</strong><span>{template.description}</span></Link>;})}</div></section>}
    {!parsed&&<div className="alert alert-error" role="alert"><strong>Some report choices were not valid.</strong><p>The previous valid definition is shown. Choose one to three matching measures and a period up to 366 days.</p></div>}
    <CustomReportBuilder definition={definition} references={references} savedId={saved?.id}/>
    {report?<><ReportOutputActions definition={definition} name={saved?.name}/><CustomReportResults report={report}/><SaveReportPanel definition={definition} savedReport={saved} role={viewer.role} canEdit={canEdit}/></>:<div className="alert alert-error" role="alert"><strong>The custom report could not load.</strong><p>Your definition is preserved. Try running the report again.</p></div>}
  </div>;
}

