import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-4000-8000-000000000801';
const otherOrg = '20000000-0000-4000-8000-000000000802';
const user = (n) => `10000000-0000-4000-8000-00000000080${n}`;
const ids = (numbers) => `array[${numbers.map((n) => `'${user(n)}'::uuid`).join(',')}]`;

test('workspace deletion enforces authorization atomically and preserves historical identities', async (t) => {
  const db = await migratedPostgres();
  const query = async (sql) => (await db.query(sql)).rows;
  try {
    await db.exec(`
      insert into auth.users(id,email) values ${[1, 2, 3, 4, 5, 6, 7].map((n) => `('${user(n)}','delete-person-${n}@example.invalid')`).join(',')};
      insert into public.organizations(id,name,slug) values
        ('${org}','Deletion workspace','deletion-workspace'), ('${otherOrg}','Other deletion workspace','other-deletion-workspace');
      insert into public.organization_memberships(organization_id,user_id,role) values
        ('${org}','${user(1)}','administrator'), ('${org}','${user(2)}','administrator'),
        ('${org}','${user(3)}','technician'), ('${org}','${user(4)}','technician'),
        ('${org}','${user(5)}','end_user'), ('${org}','${user(6)}','end_user'),
        ('${otherOrg}','${user(7)}','administrator');
      insert into public.profiles(organization_id,user_id,display_name,email)
        select organization_id,user_id,'Delete person '||right(user_id::text,1),'person'||right(user_id::text,1)||'@example.invalid'
        from public.organization_memberships;
      insert into public.inventory_managers(organization_id,user_id) values('${org}','${user(1)}');
      insert into public.tickets(organization_id,requester_id,title,description)
        values('${org}','${user(5)}','Retained deletion ticket','Historical ticket stays linked');
      insert into public.chat_conversations(organization_id,requester_id,topic)
        values('${org}','${user(5)}','Retained deletion chat');
      insert into public.assets(organization_id,tag,name,kind,status,assigned_user_id)
        values('${org}','DELETE-TEST','Retained laptop','computer','in_use','${user(5)}');
    `);
    async function asActor(n, fn, aal = 'aal1') {
      await db.exec(
        `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${user(n)}","role":"authenticated","aal":"${aal}"}',true);`,
      );
      try {
        await fn();
      } finally {
        await db.exec('rollback');
      }
    }
    const remove = (numbers, confirmed = true) =>
      query(
        `select public.delete_workspace_people('${org}',${ids(numbers)},${confirmed}) as count`,
      );

    await t.test(
      'employees, cross-workspace staff, self deletion and unconfirmed selections are rejected',
      async () => {
        await asActor(5, async () =>
          assert.rejects(remove([6]), (error) => error.code === '42501'),
        );
        await asActor(7, async () =>
          assert.rejects(remove([5]), (error) => error.code === '42501'),
        );
        await asActor(1, async () =>
          assert.rejects(remove([1]), (error) => error.code === '42501'),
        );
        await asActor(1, async () =>
          assert.rejects(remove([5], false), (error) => error.code === '22023'),
        );
        await asActor(1, async () =>
          assert.rejects(
            query(`select public.delete_workspace_people('${org}',array[]::uuid[],true)`),
            (error) => error.code === '22023',
          ),
        );
        await asActor(1, async () =>
          assert.rejects(
            query(
              `select public.delete_workspace_people('${org}',array_fill('${user(5)}'::uuid,array[26]),true)`,
            ),
            (error) => error.code === '22023',
          ),
        );
      },
    );
    await t.test('technicians cannot delete staff, including a mixed batch', async () => {
      for (const targets of [[1], [4], [5, 4]])
        await asActor(3, async () =>
          assert.rejects(remove(targets), (error) => error.code === '42501'),
        );
      assert.equal(
        (
          await query(
            `select status from public.organization_memberships where user_id='${user(5)}'`,
          )
        )[0].status,
        'active',
      );
    });
    await t.test('one foreign target rolls back the whole batch', async () => {
      await asActor(1, async () =>
        assert.rejects(remove([5, 7]), (error) => error.code === 'P0002'),
      );
      assert.equal(
        (
          await query(
            `select deleted_at from public.organization_memberships where user_id='${user(5)}'`,
          )
        )[0].deleted_at,
        null,
      );
    });
    await t.test(
      'technicians can remove employees; retries are harmless and linked records retain their IDs',
      async () => {
        await asActor(3, async () => {
          assert.equal((await remove([5, 6, 5]))[0].count, 2);
          assert.equal((await remove([5, 6]))[0].count, 0);
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.search_members('${org}','Delete person 5')`,
              )
            )[0].n,
            0,
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.search_workspace('${org}','person5') where kind='person'`,
              )
            )[0].n,
            0,
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.lookup_choices('${org}','people',active_only=>false) where id='${user(5)}'`,
              )
            )[0].n,
            0,
          );
          assert.equal(
            (
              await query(
                `select label from public.lookup_choices('${org}','people',selected=>'${user(5)}')`,
              )
            )[0].label,
            'Delete person 5 · person5@example.invalid',
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.tickets where requester_id='${user(5)}'`,
              )
            )[0].n,
            1,
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.chat_conversations where requester_id='${user(5)}'`,
              )
            )[0].n,
            1,
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.assets where assigned_user_id='${user(5)}'`,
              )
            )[0].n,
            1,
          );
          await db.exec('reset role');
          assert.equal(
            (await query(`select count(*)::int n from auth.users where id='${user(5)}'`))[0].n,
            1,
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.audit_events where action='deleted' and entity_type='organization_memberships' and actor_id='${user(3)}'`,
              )
            )[0].n,
            2,
          );
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.organization_memberships where deleted_at is not null and status='inactive'`,
              )
            )[0].n,
            2,
          );
          await db.exec(
            `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${user(5)}","role":"authenticated","aal":"aal1"}',true);`,
          );
          assert.equal(
            (await query(`select private.is_active_organization_member('${org}') as allowed`))[0]
              .allowed,
            false,
          );
          await assert.rejects(remove([6]), (error) => error.code === '42501');
        });
      },
    );
    await t.test(
      'administrators can delete another administrator while their own active access remains',
      async () => {
        await asActor(1, async () => {
          assert.equal((await remove([2, 4]))[0].count, 2);
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.organization_memberships where organization_id='${org}' and role='administrator' and status='active'`,
              )
            )[0].n,
            1,
          );
        });
      },
    );
    await t.test(
      'deleted people cannot be reactivated through the existing status endpoint',
      async () => {
        await asActor(1, async () => {
          await remove([5]);
          await assert.rejects(
            query(
              `update public.organization_memberships set status='active',deactivated_at=null where user_id='${user(5)}'`,
            ),
            (error) => error.code === '23514',
          );
        });
        await asActor(1, async () =>
          assert.rejects(
            query(
              `update public.organization_memberships set deleted_at=now() where user_id='${user(5)}'`,
            ),
            (error) => error.code === '42501',
          ),
        );
      },
    );
    await t.test(
      'inventory and automation exclude deleted people from new choices while retaining saved selections',
      async () => {
        await asActor(1, async () => {
          await remove([5]);
          assert.equal(
            (
              await query(
                `select count(*)::int n from public.inventory_choices('${org}','inventory_people',active_only=>false) where id='${user(5)}'`,
              )
            )[0].n,
            0,
          );
          assert.equal(
            (
              await query(
                `select label from public.inventory_choices('${org}','inventory_people',selected=>'${user(5)}')`,
              )
            )[0].label,
            'Delete person 5',
          );
          const choices = (
            await query(
              `select public.read_automation_admin('${org}','choices',resource=>'organization_memberships') as payload`,
            )
          )[0].payload.rows;
          assert.ok(!choices.some((row) => row.id === user(5)));
          const selected = (
            await query(
              `select public.read_automation_admin('${org}','choices',resource=>'organization_memberships',selected=>${ids([5])}) as payload`,
            )
          )[0].payload.rows;
          assert.equal(selected.length, 1);
          assert.equal(selected[0].active, false);
        });
      },
    );
    await t.test(
      'old completed invitation retries cannot claim that deleted access is still registered',
      async () => {
        await asActor(1, async () => {
          await remove([5]);
          await db.exec('reset role');
          await db.exec(
            `insert into private.member_invitations(id,organization_id,email,display_name,role,invited_by,user_id,completed_at) values('50000000-0000-4000-8000-000000000805','${org}','person5@example.invalid','Delete person 5','end_user','${user(1)}','${user(5)}',now());`,
          );
          await assert.rejects(
            query(
              `select private.prepare_member_invitation('${org}','50000000-0000-4000-8000-000000000805','person5@example.invalid','Delete person 5','end_user','${user(1)}')`,
            ),
            (error) => error.code === 'PT410',
          );
        });
      },
    );
    await t.test('MFA policy is enforced inside the database function', async () => {
      await db.exec(
        `insert into auth.mfa_factors(id,user_id,factor_type,status) values('40000000-0000-4000-8000-000000000803','${user(3)}','totp','verified');`,
      );
      await db.exec(
        `select set_config('request.jwt.claims','{"sub":"${user(1)}","role":"authenticated","aal":"aal2"}',false);`,
      );
      await db.exec(
        `insert into public.workspace_security_policies(organization_id,require_mfa,updated_by) values('${org}',true,'${user(1)}');`,
      );
      await asActor(3, async () => assert.rejects(remove([5]), (error) => error.code === '42501'));
      await asActor(3, async () => assert.equal((await remove([5]))[0].count, 1), 'aal2');
    });
    await t.test(
      'native database regression suite passes against the migrated schema',
      async () => {
        await db.exec(`reset role; select set_config('request.jwt.claims','{}',false);`);
        const results = await db.exec(
          await readFile('supabase/tests/database/people_deletion.test.sql', 'utf8'),
        );
        const tap = results
          .flatMap((result) => result.rows)
          .flatMap((row) => Object.values(row))
          .map(String);
        assert.ok(
          tap.some((line) => line.startsWith('ok 15 ')),
          JSON.stringify(tap),
        );
        assert.ok(!tap.some((line) => line.startsWith('not ok')), JSON.stringify(tap));
      },
    );
  } finally {
    await db.close();
  }
});
