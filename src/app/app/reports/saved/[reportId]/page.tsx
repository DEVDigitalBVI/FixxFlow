import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireViewer } from '@/lib/auth/viewer';
import { getCustomReport, getReportDeliveryHistory, getReportSchedules, getSavedReport } from '@/features/reporting/custom-data';
import { CustomReportResults, ReportOutputActions, ReportSchedules, SavedReportActions } from '@/features/reporting/custom-components';

export default async function SavedReportPage({params}:{params:Promise<{reportId:string}>}){
  const viewer=await requireViewer();if(viewer.role==='end_user')notFound();const {reportId}=await params;
  const saved=await getSavedReport(viewer.organizationId,reportId);if(!saved)notFound();
  const [report,schedules,deliveries]=await Promise.all([getCustomReport(viewer.organizationId,saved.definition),viewer.role==='administrator'?getReportSchedules(viewer.organizationId,saved.id):Promise.resolve([]),viewer.role==='administrator'?getReportDeliveryHistory(saved.id):Promise.resolve([])]);
  const canEdit=saved.owner_id===viewer.id||viewer.role==='administrator';
  return <div className="page reports-page saved-report-page"><PageHeader back={{href:'/app/reports',label:'Back to reports'}} eyebrow={saved.visibility==='shared'?'Shared report':'Personal report'} title={saved.name} description={saved.description??'A saved custom report that refreshes from live ticket data.'} actions={<SavedReportActions report={saved} canEdit={canEdit}/>}/>{report?<><ReportOutputActions definition={saved.definition} name={saved.name}/><CustomReportResults report={report}/></>:<div className="alert alert-error" role="alert"><strong>This report could not load.</strong><p>The saved definition is still available. Try again shortly.</p></div>}{viewer.role==='administrator'&&<ReportSchedules report={saved} schedules={schedules} deliveries={deliveries} timezone={viewer.organizationTimezone} email={viewer.email}/>}</div>;
}

