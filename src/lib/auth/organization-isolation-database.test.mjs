import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

// Exercise the actual migrated tables, grants and RLS. Only fixture constraints
// and triggers are relaxed in this disposable database, so every present/future
// tenant table gets a nonempty canary without maintaining domain-specific seeds.
// Domain triggers, foreign keys, Storage and Realtime need their separate suites.
test('every organization-owned table denies foreign reads and writes', async () => {
  const db = await migratedPostgres();
  const orgA = randomUUID(),
    orgB = randomUUID(),
    admin = randomUUID(),
    foreign = randomUUID();
  const identity = async (role, id = admin) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role, aal: 'aal1' }),
    ]);
    await db.exec(`set role ${role}`);
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Isolation A','isolation-a'),($2,'Isolation B','isolation-b')",
      [orgA, orgB],
    );
    for (const [id, org] of [
      [admin, orgA],
      [foreign, orgB],
    ]) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'administrator')",
        [org, id],
      );
    }
    const tables = (
      await db.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname <> 'library_articles' and
      (c.relname='organizations' or exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped)) order by c.relname`)
    ).rows;
    assert.ok(tables.length >= 53, 'catalog sweep includes the known tenant tables');
    for (const { relname, relrowsecurity } of tables) {
      assert.equal(relrowsecurity, true, `${relname}: RLS must be enabled`);
      const table = `public.${quote(relname)}`,
        orgColumn = relname === 'organizations' ? 'id' : 'organization_id';
      if (!['organizations', 'organization_memberships'].includes(relname)) {
        // Keep the authorization model verbatim; bypass domain fixture validation.
        await db.exec(`alter table ${table} disable trigger all`);
        const checks = (
          await db.query(
            "select conname from pg_constraint where conrelid=$1::regclass and contype='c'",
            [table],
          )
        ).rows;
        for (const { conname } of checks)
          await db.exec(`alter table ${table} drop constraint ${quote(conname)}`);
        const columns = (
          await db.query(
            `select a.attname, t.typname, t.typtype, t.typcategory,
          (select enumlabel from pg_enum e where e.enumtypid=t.oid order by enumsortorder limit 1) enumlabel
          from pg_attribute a join pg_type t on t.oid=a.atttypid where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attidentity=''`,
            [table],
          )
        ).rows;
        const values = {},
          names = [];
        for (const c of columns) {
          names.push(quote(c.attname));
          values[c.attname] =
            c.attname === 'organization_id'
              ? orgB
              : c.typname === 'uuid'
                ? c.attname === 'id'
                  ? randomUUID()
                  : admin
                : (c.enumlabel ??
                  (c.typcategory === 'A'
                    ? []
                    : c.typcategory === 'N'
                      ? 1
                      : c.typname === 'bool'
                        ? false
                        : c.typname === 'jsonb' || c.typname === 'json'
                          ? {}
                          : c.typname === 'time'
                            ? '00:00:00'
                            : c.typname === 'timetz'
                              ? '00:00:00+00'
                              : c.typcategory === 'D'
                                ? '2026-10-25T00:00:00Z'
                                : 'Isolation canary'));
        }
        await db.exec("set session_replication_role='replica'");
        await db.query(
          `insert into ${table} (${names.join(',')}) select ${names.join(',')} from jsonb_populate_record(null::${table},$1::jsonb)`,
          [JSON.stringify(values)],
        );
        await db.exec("set session_replication_role='origin'");
      }
      const ownCount = (
        await db.query(`select count(*)::int n from ${table} where ${quote(orgColumn)}=$1`, [orgB])
      ).rows[0].n;
      assert.ok(ownCount > 0, `${relname}: foreign canary exists`);
      await identity('authenticated');
      const read = await db.query(`select * from ${table} where ${quote(orgColumn)}=$1`, [orgB]);
      assert.equal(read.rows.length, 0, `${relname}: no foreign reads`);
      // Without a column grant, 42501 is itself the required write denial.
      await assert.rejects(
        db.query(`insert into ${table} (${quote(orgColumn)}) values($1)`, [orgB]),
        (e) => e.code === '42501',
        `${relname}: foreign inserts denied by RLS or grants`,
      );
      const updateColumns = (
        await db.query(
          `select a.attname from pg_attribute a where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped and has_column_privilege('authenticated',a.attrelid,a.attname,'UPDATE') limit 1`,
          [table],
        )
      ).rows;
      if (updateColumns.length) {
        const col = quote(updateColumns[0].attname);
        assert.equal(
          (
            await db.query(
              `update ${table} set ${col}=${col} where ${quote(orgColumn)}=$1 returning 1`,
              [orgB],
            )
          ).rows.length,
          0,
          `${relname}: no foreign updates`,
        );
      }
      const canDelete = (
        await db.query("select has_table_privilege('authenticated',$1,'DELETE') allowed", [table])
      ).rows[0].allowed;
      if (canDelete)
        assert.equal(
          (await db.query(`delete from ${table} where ${quote(orgColumn)}=$1 returning 1`, [orgB]))
            .rows.length,
          0,
          `${relname}: no foreign deletes`,
        );
      await db.exec('reset role');
      const anonGrants = (
        await db.query(
          "select has_any_column_privilege('anon',$1,'SELECT,INSERT,UPDATE,REFERENCES') or has_table_privilege('anon',$1,'DELETE,TRUNCATE,TRIGGER') allowed",
          [table],
        )
      ).rows[0].allowed;
      assert.equal(
        anonGrants,
        false,
        `${relname}: anonymous role has no table or column privileges`,
      );
      await identity('anon');
      await assert.rejects(
        db.query(`select * from ${table}`),
        (e) => e.code === '42501',
        `${relname}: anonymous access denied`,
      );
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('one organization per user is enforced even for inactive memberships', async () => {
  const db = await migratedPostgres();
  try {
    const user = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      user,
      `${user}@example.test`,
    ]);
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'First','unique-first'),($2,'Second','unique-second')",
      [a, b],
    );
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role,status,deactivated_at) values($1,$2,'administrator','inactive',now())",
      [a, user],
    );
    await assert.rejects(
      db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'administrator')",
        [b, user],
      ),
      (e) => e.code === '23505',
    );
  } finally {
    await db.close();
  }
});

test('membership migration refuses pre-existing duplicates without choosing a workspace', async () => {
  await assert.rejects(
    migratedPostgres({
      beforeMigration: async (db, name) => {
        if (!name.endsWith('_membership_and_shared_library.sql')) return;
        const user = randomUUID(),
          a = randomUUID(),
          b = randomUUID();
        await db.query('insert into auth.users(id,email) values($1,$2)', [
          user,
          `${user}@example.test`,
        ]);
        await db.query(
          "insert into public.organizations(id,name,slug) values($1,'Duplicate A','duplicate-a'),($2,'Duplicate B','duplicate-b')",
          [a, b],
        );
        await db.query(
          "insert into public.organization_memberships(organization_id,user_id,role) values($1,$3,'administrator'),($2,$3,'administrator')",
          [a, b, user],
        );
      },
    }),
    (error) => error.cause?.code === '23505',
  );
});
