import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  employee = '10000000-0000-0000-0000-000000000404',
  admin = '10000000-0000-0000-0000-000000000401';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
test('FAQ migration preserves guides and links while keeping employee, staff, hidden and troubleshooting scopes separate', async () => {
  let before;
  const db = await migratedPostgres({
    throughMigration: '20261101220243_fixxflow_help_faq_collections.sql',
    beforeMigration: async (db, name) => {
      if (name.endsWith('_fixxflow_help_faq_collections.sql'))
        before = (
          await db.query(
            'select id,title,content,audience,related_article_ids from public.library_articles order by id',
          )
        ).rows;
    },
  });
  try {
    const after = (
      await db.query(
        'select id,title,content,audience,related_article_ids from public.library_articles where id=any($1::uuid[]) order by id',
        [before.map((a) => a.id)],
      )
    ).rows;
    assert.deepEqual(
      after,
      before,
      'moving guides preserves IDs, content, audiences and related links',
    );
    const counts = (
      await db.query(
        'select help_collection,help_format,audience,count(*)::int n from public.library_articles group by 1,2,3',
      )
    ).rows;
    assert.equal(
      counts.filter((r) => r.help_format === 'faq').reduce((n, r) => n + r.n, 0),
      12,
    );
    assert.ok(
      counts.some((r) => r.help_collection === 'knowledge' && r.n > 0),
      'general troubleshooting stays in knowledge base',
    );
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await identity(db, employee);
    const visible = await db.query(
      "select id,audience from public.readable_knowledge_articles where help_collection='fixxflow' and help_format='faq'",
    );
    assert.equal(visible.rows.length, 6);
    assert.ok(visible.rows.every((r) => r.audience === 'employees'));
    const staffId = (
      await db.query(
        "select id from public.readable_knowledge_articles where help_collection='fixxflow' and audience='it_only' limit 1",
      )
    ).rows;
    assert.equal(staffId.length, 0);
    const search = (
      await db.query(
        "select help_collection from public.search_knowledge_articles($1,'FixxFlow')",
        [org],
      )
    ).rows;
    assert.ok(
      search.some((r) => r.help_collection === 'fixxflow'),
      'product help remains searchable',
    );
    const suggestions = (
      await db.query(
        "select s.id from public.suggest_knowledge_articles($1,'request','Accounts') s join public.library_articles a on a.id=s.id where a.help_collection='fixxflow'",
        [org],
      )
    ).rows;
    assert.equal(
      suggestions.length,
      0,
      'request suggestions do not mix product FAQs with troubleshooting',
    );
    const hidden = visible.rows[0].id;
    await identity(db, admin);
    await db.query(
      'insert into public.hidden_library_articles(organization_id,article_id) values($1,$2)',
      [org, hidden],
    );
    await identity(db, employee);
    assert.equal(
      (await db.query('select id from public.library_articles where id=$1', [hidden])).rows.length,
      0,
    );
    await identity(db, admin);
    assert.equal(
      (
        await db.query(
          "select id from public.library_articles where help_format='faq' and audience='it_only'",
        )
      ).rows.length,
      6,
    );
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.knowledge_articles where help_collection<>'knowledge'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
