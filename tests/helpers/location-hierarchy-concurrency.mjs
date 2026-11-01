import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const container = process.argv[2];
assert.match(container ?? '', /^supabase_db_[A-Za-z0-9_-]+$/);
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const org = randomUUID(),
  first = randomUUID(),
  second = randomUUID();
const args = [
  'exec',
  container,
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-qAt',
  '-v',
  'ON_ERROR_STOP=1',
];
const sql = (query) =>
  execFileSync(docker, [...args, '-c', query], { encoding: 'utf8', timeout: 15000 });
function transaction(query) {
  const child = spawn(docker, [...args, '-c', query]);
  let stdout = '',
    stderr = '';
  const finished = new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, finished };
}
try {
  sql(`insert into public.organizations(id,name,slug) values('${org}','Hierarchy concurrency fixture','hierarchy-${org}');
    insert into public.locations(id,organization_id,name) values('${first}','${org}','First'),('${second}','${org}','Second');`);
  const a = transaction(
    `begin; update public.locations set parent_id='${second}' where id='${first}'; select 'parent_locked'; select pg_sleep(1); commit;`,
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      a.child.kill();
      reject(Error('First hierarchy transaction timed out'));
    }, 10000);
    a.child.stdout.on('data', (data) => {
      if (String(data).includes('parent_locked')) {
        clearTimeout(timer);
        resolve();
      }
    });
    a.finished.then(({ code }) => {
      if (code) {
        clearTimeout(timer);
        reject(Error('First hierarchy transaction failed'));
      }
    }, reject);
  });
  const b = transaction(
    `begin; set local statement_timeout='5s'; update public.locations set parent_id='${first}' where id='${second}'; commit;`,
  );
  const [one, two] = await Promise.all([a.finished, b.finished]);
  assert.equal(one.code, 0, one.stderr);
  assert.notEqual(two.code, 0, 'Concurrent mutually-parenting updates must not both commit');
  assert.match(two.stderr, /cannot be its own ancestor/);
  assert.equal(
    sql(`select count(*) from public.location_paths where organization_id='${org}'`).trim(),
    '2',
  );
  assert.equal(
    sql(`select parent_id is null from public.locations where id='${second}'`).trim(),
    't',
  );
  console.log(
    'Concurrent hierarchy moves serialize; the conflicting cycle is rejected and both locations remain reachable.',
  );
} finally {
  sql(`delete from public.organizations where id='${org}'`);
}
