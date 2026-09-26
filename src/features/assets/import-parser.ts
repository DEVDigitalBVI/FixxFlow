import {read, utils, SSF} from 'xlsx';
import {FILE_LIMIT, IMPORT_LIMIT, headerName, rowsFromGrid} from './import-model';
export function parseAssetFile(buffer:ArrayBuffer, filename:string, selected?:string) {
 if(buffer.byteLength>FILE_LIMIT)throw Error('Choose a file smaller than 2 MB.');
 if(!/\.(csv|xlsx|xls)$/i.test(filename))throw Error('Choose a CSV, XLSX, or XLS file.');
 const csv=/\.csv$/i.test(filename);
 const workbook=read(csv?new TextDecoder('utf-8',{fatal:true}).decode(buffer):buffer,{type:csv?'string':'array',raw:true,cellFormula:true,cellText:true,cellDates:false,sheetRows:IMPORT_LIMIT+2});
 const sheet=selected??workbook.SheetNames[0];
 if(!sheet||!workbook.SheetNames.includes(sheet))throw Error('Choose a worksheet containing your assets.');
 try {
 const ws=workbook.Sheets[sheet];
 if(ws['!merges']?.length)throw Error('Unmerge cells in the asset worksheet before importing.');
 const range=utils.decode_range(ws['!fullref']??ws['!ref']??'A1');
 if(range.e.r>IMPORT_LIMIT)throw Error(`Use at most ${IMPORT_LIMIT} rows below the header. Remove extra rows or split the file.`);
 if(range.e.c>=10)throw Error('Use only the 10 template columns. Remove extra columns before importing.');
 const grid:string[][]=[];
 for(let r=0;r<=range.e.r;r++) {
  const row:string[]=[];
  for(let c=0;c<=range.e.c;c++) {
   const cell=ws[utils.encode_cell({r,c})];
   if(cell?.f||cell?.F)throw Error(`Row ${r+1} contains a formula. Paste values only before importing.`);
   if(cell?.t==='e')throw Error(`Row ${r+1} contains a spreadsheet error. Correct it before importing.`);
   let value=cell?.v==null?'':String(cell.v);
   const header=headerName(grid[0]?.[c]??'');
   if(!csv&&r>0&&['purchased_on','warranty_until'].includes(header)&&cell?.t==='n') {
    const date=SSF.parse_date_code(cell.v,{date1904:!!workbook.Workbook?.WBProps?.date1904});
    if(!date)throw Error(`Row ${r+1} contains an invalid date.`);
    value=`${String(date.y).padStart(4,'0')}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
   } else if(!csv&&cell?.t==='n') value=cell.w??value;
   if(value.length>1000)throw Error(`Row ${r+1} contains a value longer than 1,000 characters.`);
   row.push(value);
  }
  grid.push(row);
 }
 return {...rowsFromGrid(grid),sheet,sheets:workbook.SheetNames};
 } catch(error) {return {error:error instanceof Error?error.message:'The worksheet could not be read.',sheet,sheets:workbook.SheetNames};}
}
