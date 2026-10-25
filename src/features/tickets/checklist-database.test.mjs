import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  worker = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402';
const identity = async (db, id, aal = 'aal1') => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal }),
  ]);
  await db.exec('set role authenticated');
};
async function denied(db, run, pattern) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(run, pattern);
  } finally {
    await db.exec('rollback to savepoint denied; release savepoint denied');
  }
}
test('response checklist enforces assignment, lifecycle, concurrency, tenant isolation and immutable history', async (t) => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.exec('begin');
    await identity(db, admin);
    const ticket = (
      await db.query('select public.submit_incident_ticket($1,$2,$3) id', [
        org,
        randomUUID(),
        {
          requester_id: employee,
          title: 'Connectivity outage',
          description: 'Entire office cannot connect',
          priority: 'normal',
          routing_mode: 'automatic',
          incident: {
            severity: 'major',
            business_impact: 'Office cannot work',
            owner_id: worker,
            affected_services: [],
            affected_locations: [],
          },
        },
      ])
    ).rows[0].id;
    const step = randomUUID(),
      payload = {
        title: 'Contact network provider',
        instructions: 'Confirm the service outage',
        assignee_id: worker,
        due_at: '2026-10-20T15:00:00Z',
      };
    const change = async (
      operation,
      revision,
      p = payload,
      id = step,
      organization = org,
      target = ticket,
    ) =>
      (
        await db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6) rev', [
          organization,
          target,
          id,
          revision,
          operation,
          p,
        ])
      ).rows[0].rev;
    let rev = await change('add', 0);
    assert.equal(rev, 1);
    assert.equal(await change('add', 0), 1);
    assert.equal((await db.query('select * from public.incident_step_history')).rows.length, 1);
    await t.test('only assigned staff acknowledge and complete, in order', async () => {
      await denied(db, () => change('acknowledge', rev), /assigned/);
      await identity(db, worker);
      await denied(db, () => change('complete', rev), /acknowledged/);
      rev = await change('acknowledge', rev);
      await denied(db, () => change('complete', 1), /changed/);
      rev = await change('complete', rev);
      await denied(db, () => change('edit', rev, { ...payload, title: 'Changed title' }), /Reopen/);
      const saved = (await db.query('select * from public.incident_steps')).rows[0];
      assert.ok(saved.acknowledged_at);
      assert.ok(saved.completed_at);
    });
    await t.test('reopening and reassignment require renewed acknowledgement', async () => {
      await identity(db, admin);
      rev = await change('reopen', rev);
      assert.equal(
        (await db.query('select acknowledged_at from public.incident_steps')).rows[0]
          .acknowledged_at,
        null,
      );
      await identity(db, worker);
      rev = await change('acknowledge', rev);
      await identity(db, admin);
      rev = await change('edit', rev, { ...payload, assignee_id: admin });
      const saved = (await db.query('select * from public.incident_steps')).rows[0];
      assert.equal(saved.acknowledged_at, null);
      assert.equal(saved.assignee_id, admin);
      await identity(db, worker);
      await denied(db, () => change('acknowledge', rev), /assigned/);
      await identity(db, admin);
    });
    await t.test(
      'history retains immutable actor and content snapshots, without employee activity',
      async () => {
        const events = (await db.query('select * from public.incident_step_history order by id'))
          .rows;
        assert.deepEqual(
          events.map((e) => e.action),
          ['added', 'acknowledged', 'completed', 'reopened', 'acknowledged', 'reassigned'],
        );
        assert.equal(events[2].actor_id, worker);
        assert.equal(events[2].snapshot.assignee_id, worker);
        assert.equal(events.at(-1).snapshot.assignee_id, admin);
        await denied(
          db,
          () => db.query("update public.incident_step_history set action='forged'"),
          /permission denied/,
        );
        await denied(db, () => db.query('delete from public.incident_steps'), /permission denied/);
        assert.equal(
          (await db.query("select * from public.ticket_activity where action like 'step%'")).rows
            .length,
          0,
        );
      },
    );
    await t.test(
      'invalid assignment, ordinary tickets and cross-tenant writes are rejected',
      async () => {
        await denied(
          db,
          () => change('add', 0, { ...payload, assignee_id: employee }, randomUUID()),
          /assignee/,
        );
        await denied(
          db,
          () => change('add', 0, { ...payload, assignee_id: outsider }, randomUUID()),
          /assignee/,
        );
        await denied(
          db,
          () => change('add', 0, { ...payload, title: 'x' }, randomUUID()),
          /constraint/,
        );
        const normal = (
          await db.query('select public.submit_support_request($1,$2,$3,$4) id', [
            org,
            randomUUID(),
            'ticket',
            {
              requester_id: employee,
              title: 'Ordinary ticket',
              description: 'Ordinary support request',
              priority: 'normal',
              routing_mode: 'automatic',
            },
          ])
        ).rows[0].id;
        await denied(db, () => change('add', 0, payload, randomUUID(), org, normal), /unavailable/);
        for (const user of [employee, outsider]) {
          await identity(db, user);
          assert.equal((await db.query('select * from public.incident_steps')).rows.length, 0);
          assert.equal(
            (await db.query('select * from public.incident_step_history')).rows.length,
            0,
          );
          await denied(db, () => change('acknowledge', rev), /denied/);
        }
        await identity(db, admin);
      },
    );
    await t.test(
      'MFA protects both reads and mutations and direct writes cannot forge lifecycle',
      async () => {
        await denied(
          db,
          () =>
            db.query('update public.incident_steps set revision=revision+2 where id=$1', [step]),
          /changed/,
        );
        await denied(
          db,
          () =>
            db.query(
              'update public.incident_steps set acknowledged_at=now(),completed_at=now(),revision=revision+1 where id=$1',
              [step],
            ),
          /acknowledged/,
        );
        await db.exec('reset role');
        await db.query(
          "insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",
          [admin],
        );
        await identity(db, admin);
        assert.equal((await db.query('select * from public.incident_steps')).rows.length, 0);
        assert.equal((await db.query('select * from public.incident_step_history')).rows.length, 0);
        await denied(db, () => change('acknowledge', rev), /denied/);
        await identity(db, admin, 'aal2');
        rev = await change('acknowledge', rev);
        rev = await change('complete', rev);
        assert.equal(
          (await db.query('select status from public.tickets where id=$1', [ticket])).rows[0]
            .status,
          'new',
        );
      },
    );
  } finally {
    await db.exec('rollback');
    await db.close();
  }
});
