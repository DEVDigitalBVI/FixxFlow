import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { identity, ids, owner, seed, ticket } from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('ranked global search combines entities, tolerates word typos and preserves RLS and exact identifiers', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    const own = await ticket(db),
      foreign = await ticket(db, ids.otherOrg);
    for (const [row, actor] of [
      [own, ids.admin],
      [foreign, ids.otherAdmin],
    ]) {
      await identity(db, 'authenticated', actor);
      await db.query(
        "update public.tickets set title='Printer recovery',description='A paper jam' where id=$1",
        [row.id],
      );
    }
    await owner(db);
    await db.exec("select set_config('request.jwt.claims','{}',true)");
    const guide = randomUUID(),
      internal = randomUUID(),
      draft = randomUUID();
    for (const [id, audience, status] of [
      [guide, 'employees', 'published'],
      [internal, 'it_only', 'published'],
      [draft, 'employees', 'draft'],
    ]) {
      await db.query(
        `insert into public.library_articles(id,title,summary,category,audience,status,content) values($1,'Printer','Recovery steps','Hardware',$2,$3,'[{"type":"paragraph","text":"Steps"}]')`,
        [id, audience, status],
      );
    }
    await identity(db);
    const search = async (q, org = ids.org) =>
      (await db.query('select * from public.search_workspace($1,$2)', [org, q])).rows;
    let rows = await search('printer');
    assert.equal(rows[0].kind, 'article', 'Exact title outranks ticket prefix');
    assert.ok(rows.some((r) => r.id === own.id));
    assert.ok(!rows.some((r) => r.id === foreign.id || r.id === draft));
    rows = await search('pritner');
    assert.ok(rows.some((r) => r.id === own.id && r.approximate));
    rows = await search('printre recvoery');
    assert.ok(rows.some((r) => r.id === own.id && r.approximate));
    assert.equal((await search('printre zebra')).length, 0, 'All terms must match');
    assert.equal((await search('#' + own.ticket_number))[0].id, own.id);
    assert.equal(
      (await search('#' + own.ticket_number)).length,
      1,
      'Exact number excludes people and articles',
    );
    assert.equal(
      (await search('printer', ids.otherOrg)).length,
      0,
      'Cannot query another organization',
    );
    assert.equal((await search('pnr')).length, 0, 'Short fragments are not fuzzified');
    assert.equal((await search('%')).length, 0, 'Wildcards remain literal');
    assert.ok((await search('requester')).some((r) => r.kind === 'person'));
    await db.query('select public.set_library_article_hidden($1,$2,true)', [ids.org, guide]);
    assert.ok(
      !(await search('pritner')).some((r) => r.id === guide),
      'Hidden guides stay hidden for typo matches',
    );
    await identity(db, 'authenticated', ids.employee);
    rows = await search('pritner');
    assert.ok(rows.some((r) => r.id === own.id));
    assert.ok(
      !rows.some(
        (r) => r.id === internal || r.id === guide || r.id === foreign.id || r.kind === 'person',
      ),
    );
    assert.equal((await search('requester')).filter((r) => r.kind === 'person').length, 0);
    await identity(db);
    await db.query(
      `insert into public.ticket_messages(organization_id,ticket_id,author_id,body,kind) values($1,$2,$3,'unicornsecret','internal_note')`,
      [ids.org, own.id, ids.admin],
    );
    await identity(db, 'authenticated', ids.employee);
    assert.equal(
      (await search('unicornsecret')).length,
      0,
      'Internal messages never influence employee search',
    );
    await identity(db);
    assert.ok(
      (await search('unicornsecret')).some((r) => r.id === own.id),
      'Readable internal content still matches staff literal searches',
    );
    assert.ok((await search('printer')).length <= 20);
    await owner(db);
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), ids.admin],
    );
    await identity(db);
    assert.equal((await search('printer')).length, 0, 'Global search cannot bypass enrolled MFA');
    await identity(db, 'anon', null);
    await assert.rejects(search('printer'), /permission denied/);
  } finally {
    await db.close();
  }
});
