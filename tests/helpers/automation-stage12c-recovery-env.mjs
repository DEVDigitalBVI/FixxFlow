/** Verification only. Fixed disposable local Supabase identity; no hosted URLs. */
import {execFileSync, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';

export const workdir = '/tmp/fixxflow-stage12c-upgrade';
export const container = 'supabase_db_fixxflow-stage12c-upgrade';
assert.match(readFileSync(`${workdir}/supabase/config.toml`, 'utf8'), /project_id = "fixxflow-stage12c-upgrade"/);
export const local = JSON.parse(execFileSync('supabase', ['status','--workdir',workdir,'-o','json'], {encoding:'utf8',stdio:['ignore','pipe','ignore']}));
assert.equal(local.API_URL, 'http://127.0.0.1:54421');
assert.equal(new URL(local.DB_URL).hostname, '127.0.0.1');
export const client = key => createClient(local.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
export const service = client(local.SERVICE_ROLE_KEY);
export const json = value => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
export const literal = value => `'${String(value).replaceAll("'","''")}'`;
export function sql(statement, database='postgres') {
  assert.match(database,/^(postgres|stage12c_[a-z0-9_]+)$/);
  return execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
export function connection(statement, database='postgres') {
  assert.match(database,/^(postgres|stage12c_[a-z0-9_]+)$/);
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  let output='',error='',ready;
  const locked=new Promise(resolve=>{ready=resolve;});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCKED'))ready();});
  child.stderr.on('data',chunk=>{error+=chunk;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(error)));});
  child.stdin.end(statement);return {done,locked};
}
export function ok(result) {
  assert.equal(result.error,null, result.error ? `Request failed: ${result.error.code ?? result.error.status}` : undefined);
  return result.data;
}
assert.match(sql('show server_version'), /^17\./);
assert.equal(sql("select count(*) from supabase_migrations.schema_migrations"),'40');
