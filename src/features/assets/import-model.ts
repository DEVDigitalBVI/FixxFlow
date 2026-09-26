import {assetInput, assetKinds, assetStatuses} from './model';
export const IMPORT_LIMIT = 500;
export const FILE_LIMIT = 2 * 1024 * 1024;
export const importColumns = ['tag','name','kind','status','serial_number','model','assigned_email','location','purchased_on','warranty_until'] as const;
export type ImportColumn = typeof importColumns[number];
export type ImportRow = Record<ImportColumn,string> & {row:number};
export type ImportIssue = {row:number;message:string};
export type ImportResult = {rows?:ImportRow[];issues?:ImportIssue[];error?:string;success?:string};
export function headerName(value:string) { return value.replace(/^\uFEFF/,'').trim().toLowerCase().replaceAll(' ','_'); }
function choice(value:string, options:Record<string,string>, fallback:string) {
 const key=value.trim().toLowerCase();return Object.entries(options).find(([id,label])=>id===key||label.toLowerCase()===key)?.[0]??(key||fallback);
}
export function validateImport(input:unknown):ImportResult {
 if(!Array.isArray(input)||!input.length||input.length>IMPORT_LIMIT)return {error:`Choose a file with 1–${IMPORT_LIMIT} asset rows.`};
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>700000)return {error:'This batch contains too much text. Split it into smaller files and try again.'};
 const rows:ImportRow[]=[];const issues:ImportIssue[]=[];const seen=new Map<string,number>();
 for(let i=0;i<input.length;i++) {
  const raw=input[i];const row=Number.isSafeInteger(raw?.row)&&raw.row>=2&&raw.row<=IMPORT_LIMIT+1?raw.row:i+2;
  if(!raw||typeof raw!=='object'||importColumns.some(k=>typeof raw[k]!=='string'||raw[k].length>1000))return {error:'The import data is invalid. Choose the file again.'};
  const item=Object.fromEntries(importColumns.map(k=>[k,raw[k].trim()])) as Record<ImportColumn,string>;
  item.tag=item.tag.toUpperCase();item.kind=choice(item.kind,assetKinds,'computer');item.status=choice(item.status,assetStatuses,'available');
  const form=new FormData();for(const k of importColumns)if(k!=='assigned_email'&&k!=='location')form.set(k,item[k]);
  const parsed=assetInput(form);
  if(parsed.error)issues.push({row,message:parsed.error});
  if(item.assigned_email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.assigned_email)||item.assigned_email.length>254))issues.push({row,message:'Enter a valid employee email address.'});
  if(item.location.length>160)issues.push({row,message:'Location must be at most 160 characters.'});
  if(item.status==='retired'&&item.assigned_email)issues.push({row,message:'Retired assets must be unassigned.'});
  if(seen.has(item.tag))issues.push({row,message:`Asset tag is repeated in row ${seen.get(item.tag)}.`});else seen.set(item.tag,row);
  rows.push({...item,row});
 }
 return {rows,issues};
}
export function rowsFromGrid(grid:string[][]):ImportResult {
 if(!grid.length)return {error:'The selected worksheet is empty.'};
 const headers=grid[0].map(headerName);
 if(!headers.includes('tag')||!headers.includes('name'))return {error:'The first row must contain tag and name column headers. Use the template to get started.'};
 const unknown=headers.filter(h=>!importColumns.includes(h as ImportColumn));
 if(unknown.length)return {error:`Unknown or blank column header: ${unknown[0]||'(blank)'}. Use the template column names.`};
 if(new Set(headers).size!==headers.length)return {error:'Column headers must be unique.'};
 const rows=grid.slice(1).flatMap((values,index)=>values.every(v=>!v.trim())?[]:[{...Object.fromEntries(importColumns.map(k=>[k,values[headers.indexOf(k)]??''])),row:index+2}]);
 return validateImport(rows);
}
