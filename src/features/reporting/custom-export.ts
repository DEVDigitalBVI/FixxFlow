import 'server-only';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import { formatCustomValue, groupLabels, reportTypes, type CustomReport } from './custom-model';
import { PdfCharacterError } from './export-pdf';

type Cell = string | number | null;
function safeCsv(value: Cell) {
  let text=value===null?'':String(value);
  if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/u.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
const dataRows=(report:CustomReport):Cell[][]=>report.rows.map(row=>[row.label,...report.metrics.map(metric=>row.values[metric.key]??null),...report.metrics.map(metric=>row.samples[metric.key]??0)]);
export function createCustomReportCsv(report:CustomReport,organization:string,name:string){
  const headings=['Group',...report.metrics.map(metric=>`${metric.label} (${metric.unit})`),...report.metrics.map(metric=>`${metric.label} samples`)];
  const metadata:Cell[][]=[['FixxFlow custom report',name],['Organization',organization],['Generated at (UTC)',report.asOf],['Timezone',report.timezone],['Period start',report.startDate],['Period end',report.endDate],['Report type',reportTypes[report.reportType].label],['Grouped by',groupLabels[report.groupBy]],[],headings];
  return '\uFEFF'+[...metadata,...dataRows(report)].map(row=>row.map(safeCsv).join(',')).join('\r\n')+'\r\n';
}
export function createCustomReportWorkbook(report:CustomReport,organization:string,name:string):Uint8Array{
  const workbook=XLSX.utils.book_new();workbook.Props={Title:`FixxFlow custom report — ${name}`,Author:'FixxFlow',Company:organization,CreatedDate:new Date(report.asOf)};
  const overview=XLSX.utils.aoa_to_sheet([['FixxFlow custom report'],['Name',name],['Organization',organization],['Generated at (UTC)',report.asOf],['Timezone',report.timezone],['Period',`${report.startDate} to ${report.endDate}`],['Report type',reportTypes[report.reportType].label],['Grouped by',groupLabels[report.groupBy]],[],['Metric','Value','Unit','Samples','Definition'],...report.summary.map(item=>[item.label,item.value,item.unit,item.samples,report.metrics.find(metric=>metric.key===item.key)?.description??''])]);overview['!cols']=[{wch:28},{wch:28},{wch:15},{wch:12},{wch:80}];XLSX.utils.book_append_sheet(workbook,overview,'Overview');
  const headings=['Group',...report.metrics.map(metric=>`${metric.label} (${metric.unit})`),...report.metrics.map(metric=>`${metric.label} samples`)];
  const data=XLSX.utils.aoa_to_sheet([headings,...dataRows(report)]);data['!cols']=headings.map((_,index)=>({wch:index===0?34:24}));if(report.rows.length)data['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:report.rows.length,c:headings.length-1}})};XLSX.utils.book_append_sheet(workbook,data,'Report data');
  return XLSX.write(workbook,{bookType:'xlsx',type:'buffer',compression:true});
}
export async function createCustomReportPdf(report:CustomReport,organization:string,name:string):Promise<Uint8Array>{
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const base=path.join(process.cwd(),'src/features/reporting/fonts');
  const [regularBytes,boldBytes,logoBytes]=await Promise.all([readFile(path.join(base,'NotoSans-Regular.ttf')),readFile(path.join(base,'NotoSans-Bold.ttf')),readFile(path.join(process.cwd(),'public/brand/fixxflow/logo/fixxflow-logo-horizontal.png'))]);
  const regular=await doc.embedFont(regularBytes,{subset:true}),bold=await doc.embedFont(boldBytes,{subset:true}),logo=await doc.embedPng(logoBytes),supported=new Set(regular.getCharacterSet());
  const clean=(value:string)=>{const result=value.replace(/[\u0000-\u001f\u007f]/g,' ');if([...result].some(char=>!supported.has(char.codePointAt(0)!)))throw new PdfCharacterError();return result;};
  doc.setTitle(`FixxFlow custom report — ${clean(name)}`);doc.setAuthor('FixxFlow');doc.setSubject(clean(organization));doc.setCreationDate(new Date(report.asOf));doc.setLanguage('en');
  const width=595.28,height=841.89,margin=40,content=width-margin*2,ink=rgb(15/255,23/255,42/255),muted=rgb(100/255,116/255,139/255),border=rgb(226/255,232/255,240/255),surface=rgb(248/255,250/255,252/255);let page=doc.addPage([width,height]),y=height-40;
  const draw=(value:string,x:number,top:number,size=9,font:PDFFont=regular,color=ink)=>page.drawText(clean(value),{x,y:top-size,size,font,color});
  const wrap=(value:string,max:number,size=9,font:PDFFont=regular)=>{const lines:string[]=[];let line='';for(const word of clean(value).split(/\s+/)){if(line&&font.widthOfTextAtSize(`${line} ${word}`,size)<=max){line+=` ${word}`;continue;}if(line){lines.push(line);line='';}for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>max){lines.push(line);line='';}line+=char;}}if(line||!lines.length)lines.push(line);return lines;};
  const header=()=>{const logoWidth=116;page.drawImage(logo,{x:margin,y:height-40-logoWidth*logo.height/logo.width,width:logoWidth,height:logoWidth*logo.height/logo.width});draw('Custom report',width-margin-bold.widthOfTextAtSize('Custom report',11),height-43,11,bold);page.drawLine({start:{x:margin,y:height-80},end:{x:width-margin,y:height-80},color:border,thickness:1});y=height-100;};
  const next=()=>{page=doc.addPage([width,height]);header();};const paragraph=(value:string,size=10,font:PDFFont=regular,color=muted)=>{for(const line of wrap(value,content,size,font)){if(y<70)next();draw(line,margin,y,size,font,color);y-=size+5;}y-=5;};
  header();paragraph(name,20,bold,ink);paragraph(organization,11,bold,ink);paragraph(`${reportTypes[report.reportType].label} · ${report.startDate} to ${report.endDate} · ${report.timezone}`);paragraph(`Grouped by ${groupLabels[report.groupBy].toLowerCase()}. Generated ${new Intl.DateTimeFormat('en-GB',{timeZone:report.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(report.asOf))}.`);
  paragraph('Summary',15,bold,ink);for(const item of report.summary)paragraph(`${item.label}: ${formatCustomValue(item.value,item.unit)} · ${item.samples} sample${item.samples===1?'':'s'}`,10,regular,ink);
  next();paragraph('Exact report data',15,bold,ink);
  const headings=[groupLabels[report.groupBy],...report.metrics.map(metric=>metric.label)],columnCount= headings.length;const firstWidth=Math.min(180,content*.38),remaining=(content-firstWidth)/Math.max(1,columnCount-1),widths=[firstWidth,...Array(columnCount-1).fill(remaining)];
  const drawRow=(cells:string[],heading=false)=>{const wrapped=cells.map((cell,index)=>wrap(cell,widths[index]-12,8,heading?bold:regular)),lines=Math.max(...wrapped.map(item=>item.length)),rowHeight=lines*11+10;if(y-rowHeight<58){next();paragraph('Exact report data (continued)',12,bold,ink);if(!heading)drawRow(headings,true);}if(heading)page.drawRectangle({x:margin,y:y-rowHeight,width:content,height:rowHeight,color:surface});let x=margin;wrapped.forEach((items,index)=>{items.forEach((line,lineIndex)=>draw(line,x+6,y-4-lineIndex*11,8,heading?bold:regular));x+=widths[index];});y-=rowHeight;page.drawLine({start:{x:margin,y},end:{x:width-margin,y},color:border,thickness:.6});};
  drawRow(headings,true);for(const row of report.rows)drawRow([row.label,...report.metrics.map(metric=>formatCustomValue(row.values[metric.key]??null,metric.unit))]);if(!report.rows.length)paragraph('No matching data.');
  doc.getPages().forEach((item,index)=>{const footer=`Page ${index+1} of ${doc.getPageCount()}`;item.drawLine({start:{x:margin,y:48},end:{x:width-margin,y:48},color:border,thickness:1});item.drawText(`${report.startDate} to ${report.endDate}`,{x:margin,y:30,size:8,font:regular,color:muted});item.drawText(footer,{x:width-margin-regular.widthOfTextAtSize(footer,8),y:30,size:8,font:regular,color:muted});});return doc.save();
}

