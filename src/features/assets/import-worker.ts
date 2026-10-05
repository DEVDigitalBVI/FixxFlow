import {parseAssetFile} from './import-parser';
self.onmessage=(event:MessageEvent<{buffer:ArrayBuffer;filename:string;sheet?:string}>)=>{
 try {self.postMessage(parseAssetFile(event.data.buffer,event.data.filename,event.data.sheet));}
 catch(error) {self.postMessage({error:error instanceof Error?error.message:'The file could not be read. Save a fresh CSV or Excel file and try again.'});}
};
