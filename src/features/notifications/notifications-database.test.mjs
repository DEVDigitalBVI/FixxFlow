import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('live notifications publish changes while existing recipient, email and chat rules still hold',async()=>{
 const db=await migratedPostgres();
 try {
  const published=()=>db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'");
  assert.equal((await published()).rows.length,1);
  await db.exec(await readFile('supabase/migrations/20261018011834_live_notification_updates.sql','utf8'));
  assert.equal((await published()).rows.length,1);
  await db.exec(await readFile('supabase/tests/notification-regression.sql','utf8'));
 } finally {await db.close();}
});
