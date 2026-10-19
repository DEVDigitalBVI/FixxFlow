import {copyFile,mkdir,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// public/brand is the approved, versioned artwork; brand/ is a local handoff copy.
const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.join(root,'public/brand/fixxflow');
const destination=path.join(root,'brand/fixxflow');
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--check'))throw Error('Usage: node scripts/sync-brand-assets.mjs [--check]');
const check=args.includes('--check');
async function files(directory,prefix=''){
 let entries;
 try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const result=[];
 for(const entry of entries){
  if(entry.name.startsWith('.'))continue;
  const relative=path.join(prefix,entry.name);
  if(entry.isDirectory())result.push(...await files(path.join(directory,entry.name),relative));
  else if(entry.isFile())result.push(relative);
  else throw Error(`Unexpected non-file brand asset: ${relative}`);
 }
 return result.sort();
}
const names=await files(source);
if(!names.length)throw Error('Approved brand package is missing or empty.');
const differences=[];
for(const name of names){
 const from=path.join(source,name),to=path.join(destination,name);
 const approved=await readFile(from);
 let current;
 try{current=await readFile(to);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(current?.equals(approved))continue;
 differences.push(name);
 if(!check){await mkdir(path.dirname(to),{recursive:true});await copyFile(from,to);}
}
const extra=(await files(destination)).filter(name=>!names.includes(name));
if(extra.length)throw Error(`Unrecognized handoff assets require review: ${extra.join(', ')}`);
if(check&&differences.length)throw Error(`Brand package is out of date. Run npm run brand:sync. Mismatched assets: ${differences.join(', ')}`);
console.log(check?`Verified ${names.length} brand files match the approved package byte for byte.`:`Synchronized ${names.length} brand files (${differences.length} updated) into brand/fixxflow.`);
