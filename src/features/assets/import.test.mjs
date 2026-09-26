import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const XLSX=require('xlsx');
function load(file,mocks={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(n=>mocks[n]??require(n),m,m.exports);return m.exports;}
const model=load('src/features/assets/model.ts');
const imports=load('src/features/assets/import-model.ts',{'./model':model});
const {parseAssetFile}=load('src/features/assets/import-parser.ts',{'./import-model':imports});
const row=(values={})=>({...Object.fromEntries(imports.importColumns.map(k=>[k,''])),row:2,tag:'PC-001',name:'Laptop',...values});
const csv=text=>new TextEncoder().encode(text).buffer;
const workbook=(rows,extra)=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Assets');extra?.(wb);return XLSX.write(wb,{type:'array',bookType:'xlsx'});};
test('CSV handles BOM, quoted commas, multiline cells and text identifiers',()=>{
 const result=parseAssetFile(csv('\uFEFFtag,name,serial_number\r\n00123,"Laptop, reception",00045\r\nPC-2,"Two\nlines",002\r\n'),'assets.csv');
 assert.equal(result.rows.length,2);assert.equal(result.rows[0].tag,'00123');assert.equal(result.rows[0].serial_number,'00045');assert.equal(result.rows[1].name,'Two\nlines');assert.equal(result.rows[0].kind,'computer');assert.equal(result.rows[0].status,'available');
});
test('headers are validated and normalized without silently ignoring columns',()=>{
 assert.equal(imports.rowsFromGrid([['Asset ID','name'],['A','Laptop']]).rows,undefined);
 assert.match(imports.rowsFromGrid([['tag','name','tag'],['A','Laptop','B']]).error,/unique/);
 assert.match(imports.rowsFromGrid([['tag','name','cost'],['A','Laptop','1']]).error,/Unknown/);
 assert.equal(imports.rowsFromGrid([[' TAG ',' Name '],['a','Laptop']]).rows[0].tag,'A');
});
test('validation rejects duplicate tags, impossible dates, invalid states and invalid retirement',()=>{
 assert.match(imports.validateImport([row(),row({tag:'pc-001',row:3})]).issues[0].message,/repeated/);
 for(const date of ['2026-02-30','0000-01-01','2026-13-01'])assert.ok(imports.validateImport([row({purchased_on:date})]).issues.length);
 assert.equal(imports.validateImport([row({purchased_on:'2024-02-29'})]).issues.length,0);
 assert.ok(imports.validateImport([row({status:'retired',assigned_email:'a@example.com'})]).issues.length);
 assert.ok(imports.validateImport([row({kind:'__proto__'})]).issues.length);
 assert.equal(imports.validateImport([row({kind:'Network equipment',status:'Under repair'})]).rows[0].kind,'network');
 assert.match(imports.validateImport(Array.from({length:501},()=>row())).error,/500/);
 assert.ok(imports.validateImport([{...row(),name:123}]).error);
});
test('Excel imports formatted identifiers and real dates, rejects formulas and merged cells',()=>{
 const buffer=workbook([['tag','name','purchased_on'],[123,'Laptop',46023]],wb=>{wb.Sheets.Assets.A2.z='00000';wb.Sheets.Assets.C2.z='yyyy-mm-dd';});
 const result=parseAssetFile(buffer,'assets.xlsx');assert.equal(result.rows[0].tag,'00123');assert.equal(result.rows[0].purchased_on,'2026-01-01');
 const formula=workbook([['tag','name'],['A','Laptop']],wb=>{wb.Sheets.Assets.B2.f='"Laptop"';});assert.match(parseAssetFile(formula,'assets.xlsx').error,/formula/);
 const merged=workbook([['tag','name'],['A','Laptop']],wb=>{wb.Sheets.Assets['!merges']=[{s:{r:1,c:0},e:{r:1,c:1}}];});assert.match(parseAssetFile(merged,'assets.xlsx').error,/Unmerge/);
});
test('worksheet selection survives an invalid first sheet and honors the 1904 date system',()=>{
 const buffer=workbook([['Readme'],['Use the Inventory sheet']],wb=>{wb.Workbook={WBProps:{date1904:true}};XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['tag','name','purchased_on'],['A','Laptop',1]]),'Inventory');});
 assert.equal(parseAssetFile(buffer,'test.xlsx').sheets.length,2);
 assert.equal(parseAssetFile(buffer,'test.xlsx','Inventory').rows[0].purchased_on,'1904-01-02');
});
test('file size, format, row and column limits reject oversized inputs',()=>{
 assert.throws(()=>parseAssetFile(new ArrayBuffer(imports.FILE_LIMIT+1),'assets.xlsx'),/2 MB/);
 assert.throws(()=>parseAssetFile(csv('abc'),'assets.pdf'),/CSV/);
 const rows=[['tag','name'],...Array.from({length:501},(_,i)=>[`A-${i}`,'Laptop'])];assert.match(parseAssetFile(workbook(rows),'test.xlsx').error,/500/);
});
function actions(role='technician',fixtures={},failure=null) {
 const calls=[];
 const db={from:table=>{let inserting=false;const filters=[];const builder=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:fixtures[table]??[],error:inserting?failure:null}).then(resolve):(...args)=>{calls.push([table,key,...args]);filters.push([key,...args]);if(key==='insert')inserting=true;return builder;}});return builder;}};
 return {...load('src/app/app/assets/import/actions.ts',{'next/cache':{revalidatePath:()=>{}},'@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'verified-org'})},'@/lib/supabase/server':{createClient:async()=>db},'@/features/assets/model':model,'@/features/assets/import-model':imports}),calls};
}
test('employees cannot preview or save and malformed batches stop before database calls',async()=>{
 const employee=actions('end_user');assert.match((await employee.importAssets([row()],'save')).error,/Only IT/);assert.equal(employee.calls.length,0);
 const invalid=actions();assert.ok((await invalid.importAssets([row({name:''})],'save')).issues.length);assert.equal(invalid.calls.length,0);
});
test('preview never writes, duplicates and unknown references block the whole batch',async()=>{
 const preview=actions();assert.equal((await preview.importAssets([row()],'preview')).issues.length,0);assert.ok(!preview.calls.some(c=>c[1]==='insert'));
 const duplicate=actions('technician',{assets:[{tag:'PC-001'}]});assert.ok((await duplicate.importAssets([row()],'save')).issues.length);assert.ok(!duplicate.calls.some(c=>c[1]==='insert'));
 const unknown=actions();assert.ok((await unknown.importAssets([row({assigned_email:'a@example.com',location:'Unknown'})],'save')).issues.length===2);assert.ok(!unknown.calls.some(c=>c[1]==='insert'));
});
test('save rechecks references and creates one tenant-scoped insert with only allowed fields',async()=>{
 const user='11111111-1111-4111-8111-111111111111',place='22222222-2222-4222-8222-222222222222';
 const a=actions('administrator',{profiles:[{user_id:user,email:'a@example.com'}],organization_memberships:[{user_id:user}],locations:[{id:place,name:'Office'}]});
 const result=await a.importAssets([row({assigned_email:'a@example.com',location:'Office',organization_id:'evil',id:'evil'}),row({row:3,tag:'PC-2'})],'save');
 assert.ok(result.success,JSON.stringify(result));assert.match(result.success,/2 assets/);const insert=a.calls.filter(c=>c[1]==='insert');assert.equal(insert.length,1);assert.equal(insert[0][2].length,2);
 const first=insert[0][2][0];assert.equal(first.organization_id,'verified-org');assert.equal(first.assigned_user_id,user);assert.equal(first.location_id,place);assert.equal(first.id,undefined);assert.equal(first.assigned_email,undefined);
 for(const table of ['assets','profiles','locations','organization_memberships'])assert.ok(a.calls.some(c=>c[0]===table&&c[1]==='eq'&&c[2]==='organization_id'&&c[3]==='verified-org'));
});
test('save-time conflicts remain recoverable without any update or upsert',async()=>{
 const a=actions('administrator',{}, {code:'23505'});assert.match((await a.importAssets([row()],'save')).error,/No rows/);assert.ok(!a.calls.some(c=>['upsert','update','delete'].includes(c[1])));
});

test('legacy XLS files retain text serial numbers',()=>{
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['tag','name','serial_number'],['LEGACY-1','Office printer','00023']]),'Assets');
 const result=parseAssetFile(XLSX.write(wb,{type:'array',bookType:'xls'}),'legacy.xls');assert.equal(result.rows[0].serial_number,'00023');assert.equal(result.issues.length,0);
});
test('batches with oversized Unicode payloads request smaller files before server submission',()=>{
 const rows=Array.from({length:500},(_,i)=>row({row:i+2,tag:`PC-${i}`,name:'設'.repeat(160),model:'設'.repeat(160),serial_number:'設'.repeat(120)}));
 assert.match(imports.validateImport(rows).error,/smaller files/);
});
