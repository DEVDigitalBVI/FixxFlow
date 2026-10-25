import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('shared library enforces audience, lifecycle, active membership, owner MFA and revisions', async () => {
  const db = await migratedPostgres();
  const orgA = randomUUID(),
    orgB = randomUUID(),
    owner = randomUUID(),
    session = randomUUID();
  const users = {
    employee: randomUUID(),
    tech: randomUUID(),
    admin: randomUUID(),
    foreign: randomUUID(),
    inactive: randomUUID(),
    unassigned: randomUUID(),
  };
  const identity = async (id, aal = 'aal1', session_id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, aal, role: 'authenticated', session_id }),
    ]);
    await db.exec('set role authenticated');
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Library A','library-a'),($2,'Library B','library-b')",
      [orgA, orgB],
    );
    for (const [key, id] of Object.entries({ ...users, owner })) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
      if (!['owner', 'unassigned'].includes(key))
        await db.query(
          "insert into public.organization_memberships(organization_id,user_id,role,status,deactivated_at) values($1,$2,$3,$4::public.membership_status,case when $4::public.membership_status='inactive' then now() else null end)",
          [
            key === 'foreign' ? orgB : orgA,
            id,
            key === 'tech'
              ? 'technician'
              : key === 'admin' || key === 'foreign'
                ? 'administrator'
                : 'end_user',
            key === 'inactive' ? 'inactive' : 'active',
          ],
        );
    }
    await db.query('insert into private.platform_owners(user_id) values($1)', [owner]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, owner]);
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), owner],
    );
    assert.equal(
      (await db.query('select count(*)::int n from public.library_articles')).rows[0].n,
      70,
    );
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from public.library_articles where author_id is not null',
        )
      ).rows[0].n,
      0,
    );
    const ids = {};
    for (const [name, status, audience] of [
      ['employee', 'published', 'employees'],
      ['internal', 'published', 'it_only'],
      ['draft', 'draft', 'employees'],
      ['archived', 'archived', 'employees'],
    ]) {
      ids[name] = randomUUID();
      await db.query(
        'insert into public.library_articles(id,title,category,status,audience,content) values($1,$2,\'Software\',$3,$4,\'[{"type":"paragraph","text":"Library visibility probe"}]\')',
        [ids[name], `Library visibility probe ${name}`, status, audience],
      );
    }
    const visible = async () =>
      (
        await db.query(
          "select id from public.library_articles where title like 'Library visibility probe%' order by title",
        )
      ).rows
        .map((r) => r.id)
        .sort();
    for (const name of ['employee', 'tech', 'admin', 'foreign', 'inactive', 'unassigned']) {
      await identity(users[name]);
      const expected =
        name === 'employee'
          ? [ids.employee]
          : ['tech', 'admin', 'foreign'].includes(name)
            ? [ids.employee, ids.internal]
            : [];
      assert.deepEqual(await visible(), expected.sort(), `${name} visibility`);
      if (name === 'employee')
        assert.equal(
          (await db.query('select count(*)::int n from public.library_articles')).rows[0].n,
          43,
          'new workspace receives 42 employee guides automatically',
        );
      if (name === 'tech')
        assert.equal(
          (await db.query('select count(*)::int n from public.library_articles')).rows[0].n,
          72,
          'staff also receive 28 IT-only guides',
        );
      await assert.rejects(
        db.query(
          "insert into public.library_articles(title,category) values('Unauthorized guide','Software')",
        ),
        (e) => e.code === '42501',
      );
      assert.equal(
        (
          await db.query(
            "update public.library_articles set title='Unauthorized revision' where id=$1 returning id",
            [ids.employee],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query('delete from public.library_articles where id=$1', [ids.employee]),
        (e) => e.code === '42501',
      );
    }
    await identity(users.foreign);
    assert.equal(
      (
        await db.query(
          "select id from public.search_knowledge_articles($1,'Library visibility probe')",
          [orgB],
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await db.query(
          "select id from public.search_knowledge_articles($1,'Library visibility probe')",
          [orgA],
        )
      ).rows.length,
      0,
      'cannot search on behalf of another workspace',
    );
    await identity(owner, 'aal1', session);
    assert.deepEqual(await visible(), [], 'owner must complete MFA');
    await assert.rejects(
      db.query(
        "insert into public.library_articles(title,category) values('MFA required','Software')",
      ),
      (e) => e.code === '42501',
    );
    await identity(owner, 'aal2', session);
    assert.equal((await visible()).length, 4);
    assert.equal(
      (
        await db.query(
          "select id from public.search_knowledge_articles($1,'Library visibility probe')",
          [orgA],
        )
      ).rows.length,
      4,
      'owner search includes drafts',
    );
    const updated = await db.query(
      "update public.library_articles set summary='Updated once for every workspace' where id=$1 and revision=1 returning revision",
      [ids.employee],
    );
    assert.equal(updated.rows[0].revision, 2);
    assert.equal(
      (
        await db.query(
          "update public.library_articles set summary='stale' where id=$1 and revision=1 returning id",
          [ids.employee],
        )
      ).rows.length,
      0,
    );
    const created = await db.query(
      "insert into public.library_articles(title,category,content) values('Owner draft','Software','[]') returning status,audience",
    );
    assert.deepEqual(created.rows[0], { status: 'draft', audience: 'it_only' });
    await assert.rejects(
      db.query('update public.library_articles set related_article_ids=$1 where id=$2', [
        [randomUUID()],
        ids.employee,
      ]),
      /Related articles must belong/,
    );
    await assert.rejects(
      db.query('update public.library_articles set content=$1 where id=$2', [
        JSON.stringify([{ type: 'image', text: 'Alt', assetId: randomUUID() }]),
        ids.employee,
      ]),
      /image uploads/,
    );
    await db.exec('reset role');
    assert.ok(
      (
        await db.query(
          "select id from private.platform_audit where action='library_article_update'",
        )
      ).rows.length,
    );
    await identity(users.foreign);
    assert.equal(
      (await db.query('select summary from public.library_articles where id=$1', [ids.employee]))
        .rows[0].summary,
      'Updated once for every workspace',
    );
    await identity(users.employee);
    assert.equal(
      (await db.query('select summary from public.library_articles where id=$1', [ids.employee]))
        .rows[0].summary,
      'Updated once for every workspace',
    );
    await db.exec('reset role');
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), users.employee],
    );
    await identity(users.employee);
    assert.deepEqual(await visible(), [], 'enrolled members must satisfy MFA');
    await identity(users.employee, 'aal2');
    assert.deepEqual(await visible(), [ids.employee]);
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1', [session]);
    await identity(owner, 'aal2', session);
    assert.deepEqual(await visible(), [], 'revoked owner session loses access');
    await db.exec('reset role; set role anon');
    await assert.rejects(
      db.query('select * from public.library_articles'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      db.query('select * from public.readable_knowledge_articles'),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
