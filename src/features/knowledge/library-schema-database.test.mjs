import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

// library_articles is cloned from knowledge_articles, readable_knowledge_articles unions
// both with `select *`, and search_knowledge_articles returns knowledge_articles rows
// from that view. A column added to only one table silently breaks search, so any
// change to either table must be mirrored and the view recreated.
const columns = (db, table) =>
  db
    .query(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a
       where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
       order by a.attnum`,
      [table],
    )
    .then((result) => result.rows);

test('library, workspace articles and the shared view keep identical columns', async () => {
  const db = await migratedPostgres();
  try {
    const workspace = await columns(db, 'public.knowledge_articles');
    assert.ok(workspace.length > 10, 'knowledge_articles columns were read');
    assert.deepEqual(
      await columns(db, 'public.library_articles'),
      workspace,
      'library_articles must match knowledge_articles column-for-column',
    );
    assert.deepEqual(
      await columns(db, 'public.readable_knowledge_articles'),
      workspace,
      'readable_knowledge_articles must be recreated after either table changes',
    );
  } finally {
    await db.close();
  }
});

test('search returns both workspace and library rows through the shared view', async () => {
  const db = await migratedPostgres();
  const org = randomUUID(),
    member = randomUUID();
  const body = JSON.stringify([{ type: 'paragraph', text: 'Schema parity canary text.' }]);
  try {
    await db.query("insert into public.organizations(id,name,slug) values($1,'Parity','parity')", [
      org,
    ]);
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
      member,
      `${member}@example.test`,
    ]);
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'end_user')",
      [org, member],
    );
    await db.query(
      `insert into public.knowledge_articles(organization_id,category,title,content,status,audience)
       values($1,'Network','Workspace parity canary',$2::jsonb,'published','employees')`,
      [org, body],
    );
    await db.query(
      `insert into public.library_articles(id,category,title,summary,content,status,audience)
       values($1,'Network','Library parity canary','',$2::jsonb,'published','employees')`,
      [randomUUID(), body],
    );
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: member, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.exec('set role authenticated');
    const titles = (
      await db.query("select title from public.search_knowledge_articles($1,'parity canary')", [
        org,
      ])
    ).rows
      .map((row) => row.title)
      .sort();
    assert.deepEqual(titles, ['Library parity canary', 'Workspace parity canary']);
  } finally {
    await db.close();
  }
});
