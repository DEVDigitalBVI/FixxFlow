import { requireViewer } from '@/lib/auth/viewer';
import { reportServerError } from '@/lib/server-errors';
import { defaultReportDefinition, definitionFromInput } from '@/features/reporting/custom-model';
import { getCustomReport } from '@/features/reporting/custom-data';
import { exportFormats, isExportFormat } from '@/features/reporting/export-model';
import { createCustomReportCsv, createCustomReportPdf, createCustomReportWorkbook } from '@/features/reporting/custom-export';
import { PdfCharacterError } from '@/features/reporting/export-pdf';

export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const failure=(error:string,status:number,reference?:string)=>Response.json({error,...(reference?{reference}:{})},{status,headers:{...headers,...(reference?{'X-Correlation-ID':reference}:{})}});
export async function GET(request:Request){
  const viewer=await requireViewer();if(viewer.role==='end_user')return failure('Report downloads are available to support staff only.',403);
  const query=new URL(request.url).searchParams,format=query.get('format');if(!isExportFormat(format))return failure('Choose Excel, CSV, or PDF.',400);
  const end=query.get('endDate')??new Date().toISOString().slice(0,10),definition=definitionFromInput(query,defaultReportDefinition(end));if(!definition)return failure('The custom report definition is invalid.',400);
  const name=(query.get('name')??'Custom report').trim().slice(0,120)||'Custom report';
  try{const report=await getCustomReport(viewer.organizationId,definition,{throwOnError:true});if(!report)return failure('Reporting is temporarily unavailable. Please try again.',503);
    const bytes=format==='csv'?new TextEncoder().encode(createCustomReportCsv(report,viewer.organizationName,name)):format==='xlsx'?createCustomReportWorkbook(report,viewer.organizationName,name):await createCustomReportPdf(report,viewer.organizationName,name);
    const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'report';
    return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':`${exportFormats[format].mime}${format==='csv'?'; charset=utf-8':''}`,'Content-Disposition':`attachment; filename="fixxflow-custom-report-${slug}-${report.endDate}.${format}"`}});
  }catch(error){if(error instanceof PdfCharacterError)return failure(error.message,422);const reference=reportServerError('report.custom.export',error);return failure('The custom report could not be downloaded. Please try again.',500,reference);}
}

