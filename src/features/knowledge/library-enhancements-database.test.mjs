import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  otherOrg = '20000000-0000-0000-0000-000000000402';
const admin = '10000000-0000-0000-0000-000000000401',
  tech = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  foreign = '10000000-0000-0000-0000-000000000402';
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
async function identity(db, id, aal = 'aal1', sessionId) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal, session_id: sessionId }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, sql, args = []) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(db.query(sql, args));
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
test('library preferences, usage and ranked suggestions enforce organization, audience, publication and MFA boundaries', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await db.exec(await fs.readFile('tests/fixtures/domain-events.sql', 'utf8'));
    const owner = randomUUID(),
      ownerSession = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      owner,
      `${owner}@example.invalid`,
    ]);
    await db.query('insert into private.platform_owners(user_id) values($1)', [owner]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [ownerSession, owner]);
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), owner],
    );
    const guide = randomUUID(),
      internal = randomUUID(),
      draft = randomUUID();
    for (const [id, audience, status] of [
      [guide, 'employees', 'published'],
      [internal, 'it_only', 'published'],
      [draft, 'employees', 'draft'],
    ])
      await db.query(
        'insert into public.library_articles(id,title,summary,category,audience,status,content) values($1,\'Zebra VPN recovery\',\'Fix a zebra VPN outage\',\'Network\',$2,$3,\'[{"type":"paragraph","text":"Steps"}]\')',
        [id, audience, status],
      );
    const oldGuide = randomUUID();
    await db.query(
      "insert into public.knowledge_articles(id,organization_id,title,summary,category,status,audience,content,updated_at) values($1,$2,'Needlejaguar repair','An older relevant guide','Hardware','published','employees','[{\"type\":\"paragraph\",\"text\":\"Steps\"}]',now()-interval '1 year')",
      [oldGuide, org],
    );
    await db.query(
      "insert into public.knowledge_articles(organization_id,title,category,status,audience,content) select $1,'Recent unrelated guide '||n,'Hardware','published','employees','[{\"type\":\"paragraph\",\"text\":\"Unrelated\"}]'::jsonb from generate_series(1,220) n",
      [org],
    );
    await identity(db, employee);
    assert.equal(
      (await db.query("select id from public.suggest_knowledge_articles($1,'needlejaguar')", [org]))
        .rows[0].id,
      oldGuide,
      'suggestions search beyond the newest 200 articles',
    );
    assert.ok(
      (await db.query("select * from public.suggest_knowledge_articles($1,'wifi')", [org])).rows
        .length,
      'Wi-Fi titles also match wifi',
    );
    let rows = (
      await db.query("select * from public.suggest_knowledge_articles($1,'zebra vpn issue')", [org])
    ).rows;
    assert.ok(rows.some((row) => row.id === guide));
    assert.ok(!rows.some((row) => [internal, draft].includes(row.id)));
    assert.equal(
      (await db.query("select * from public.suggest_knowledge_articles($1,'zebra')", [otherOrg]))
        .rows.length,
      0,
    );
    await db.query('select public.record_library_article_view($1,$2)', [org, guide]);
    await db.query('select public.record_library_article_view($1,$2)', [org, guide]);
    await db.query('select public.rate_library_article($1,$2,true)', [org, guide]);
    await db.query('select public.rate_library_article($1,$2,false)', [org, guide]);
    await denied(db, 'select public.record_library_article_view($1,$2)', [otherOrg, guide]);
    await denied(db, 'select public.rate_library_article($1,$2,true)', [org, internal]);
    await denied(db, 'select public.rate_library_article($1,$2,true)', [org, draft]);
    for (const user of [employee, tech, foreign]) {
      await identity(db, user);
      await denied(db, 'select public.set_library_article_hidden($1,$2,true)', [org, guide]);
      await denied(db, 'select * from public.workspace_library_choices($1)', [org]);
      await denied(db, 'select * from public.library_article_usage($1)', [guide]);
    }
    await identity(db, admin);
    assert.equal(
      (
        await one(db, 'select count(*) n from public.library_article_views where article_id=$1', [
          guide,
        ])
      ).n,
      1,
    );
    assert.equal(
      (
        await one(db, 'select helpful from public.library_article_feedback where article_id=$1', [
          guide,
        ])
      ).helpful,
      false,
    );
    await db.query('select public.set_library_article_hidden($1,$2,true)', [org, guide]);
    await db.query('select public.set_library_article_hidden($1,$2,true)', [org, guide]);
    assert.equal(
      (await db.query('select id from public.library_articles where id=$1', [guide])).rows.length,
      0,
    );
    const catalog = (
      await db.query("select * from public.workspace_library_choices($1,'Zebra')", [org])
    ).rows;
    assert.ok(catalog.some((row) => row.id === guide && row.hidden));
    await identity(db, employee);
    assert.equal(
      (await db.query('select id from public.readable_knowledge_articles where id=$1', [guide]))
        .rows.length,
      0,
    );
    assert.ok(
      !(
        await db.query("select * from public.search_knowledge_articles($1,'zebra')", [org])
      ).rows.some((row) => row.id === guide),
    );
    assert.ok(
      !(
        await db.query("select * from public.suggest_knowledge_articles($1,'zebra')", [org])
      ).rows.some((row) => row.id === guide),
    );
    await denied(db, 'select public.record_library_article_view($1,$2)', [org, guide]);
    await denied(db, 'select public.rate_library_article($1,$2,true)', [org, guide]);
    await identity(db, foreign);
    assert.equal(
      (await db.query('select id from public.library_articles where id=$1', [guide])).rows.length,
      1,
      'other workspace still sees shared guide',
    );
    assert.equal(
      (await db.query('select * from public.library_article_feedback where article_id=$1', [guide]))
        .rows.length,
      0,
    );
    await identity(db, owner, 'aal2', ownerSession);
    assert.equal(
      (await db.query('select id from public.library_articles where id=$1', [guide])).rows.length,
      1,
      'workspace hiding never withdraws the platform source',
    );
    const totals = await one(db, 'select * from public.library_article_usage($1)', [guide]);
    assert.deepEqual(totals, { views: 1, helpful: 0, unhelpful: 1, workspaces: 1 });
    await identity(db, admin);
    await db.query('select public.set_library_article_hidden($1,$2,false)', [org, guide]);
    assert.equal(
      (await db.query('select id from public.library_articles where id=$1', [guide])).rows.length,
      1,
    );
    assert.equal(
      (
        await one(
          db,
          "select count(*) n from public.audit_events where entity_type='library_visibility' and entity_id=$1",
          [guide],
        )
      ).n,
      2,
      'audit only actual visibility changes',
    );
    await db.exec('reset role');
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), admin],
    );
    await identity(db, admin, 'aal1');
    await denied(db, 'select * from public.workspace_library_choices($1)', [org]);
    await identity(db, admin, 'aal2');
    assert.ok(
      (await db.query('select * from public.workspace_library_choices($1)', [org])).rows.length > 0,
    );
    await db.exec('reset role;rollback');
  } finally {
    await db.close();
  }
});
