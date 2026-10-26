import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401';
const employee = '10000000-0000-0000-0000-000000000404';
const admin = '10000000-0000-0000-0000-000000000401';
const outsider = '10000000-0000-0000-0000-000000000402';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
const payload = {
  requester_id: employee,
  title: 'Pilot request',
  description: 'Cannot connect',
  priority: 'normal',
  routing_mode: 'automatic',
  team_id: null,
  category_id: null,
  subcategory_id: null,
  location_id: null,
  assigned_technician_id: null,
  due_at: null,
};
const submit = async (db, kind, input, token = randomUUID()) =>
  (
    await db.query('select public.submit_support_request($1,$2,$3,$4) id', [
      org,
      token,
      kind,
      input,
    ])
  ).rows[0].id;
async function denied(db, fn, pattern) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(fn, pattern);
  } finally {
    await db.exec('rollback to savepoint denied; release savepoint denied');
  }
}

test('support submission receipts preserve atomicity, permissions and retry identity', async (t) => {
  const db = await migratedPostgres();
  const scenario = async (name, run) =>
    t.test(name, async () => {
      await db.exec('begin');
      try {
        await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
        await db.exec(
          "create function pg_temp.support_minutes(a timestamptz,b timestamptz,z text) returns double precision language sql security definer as 'select private.sla_business_seconds(a,b,z)/60'",
        );
        await identity(db, employee);
        await run();
      } finally {
        await db.exec('rollback; reset role');
      }
    });
  try {
    await scenario(
      'reported impact persists independently, rejects invalid values and survives retries',
      async () => {
        for (const impact of [
          'minor_inconvenience',
          'work_blocked',
          'team_affected',
          'operations_stopped',
        ]) {
          for (const [kind, input] of [
            ['ticket', payload],
            [
              'equipment',
              {
                asset: '60000000-0000-0000-0000-000000000401',
                title: 'Impact request',
                description: 'Cannot connect',
              },
            ],
          ]) {
            const token = randomUUID(),
              request = { ...input, reported_impact: impact };
            const id = await submit(db, kind, request, token);
            assert.equal(await submit(db, kind, request, token), id);
            let row = (
              await db.query(
                'select reported_impact,priority,pg_temp.support_minutes(created_at,response_sla_due_at,sla_timezone) response_minutes,pg_temp.support_minutes(created_at,resolution_sla_due_at,sla_timezone) resolution_minutes from public.tickets where id=$1',
                [id],
              )
            ).rows[0];
            const [priority, response, resolution] = {
              minor_inconvenience: ['low', 480, 2880],
              work_blocked: ['normal', 240, 1440],
              team_affected: ['high', 60, 480],
              operations_stopped: ['critical', 15, 240],
            }[impact];
            assert.equal(row.reported_impact, impact);
            assert.equal(row.priority, priority);
            assert.equal(Number(row.response_minutes), response);
            assert.equal(Number(row.resolution_minutes), resolution);
            await identity(db, admin);
            await db.query("update public.tickets set priority='high' where id=$1", [id]);
            row = (
              await db.query('select reported_impact,priority from public.tickets where id=$1', [
                id,
              ])
            ).rows[0];
            assert.equal(row.reported_impact, impact);
            assert.equal(row.priority, 'high');
            await identity(db, employee);
            await denied(
              db,
              () => submit(db, kind, { ...request, reported_impact: 'invalid' }),
              /check constraint/,
            );
            await denied(
              db,
              () => submit(db, kind, { ...request, reported_impact: 'invalid' }, token),
              /different input/,
            );
          }
        }
      },
    );
    await scenario(
      'a lost ticket response retries to one ticket, even after its details change',
      async () => {
        const token = randomUUID(),
          id = await submit(db, 'ticket', payload, token);
        await identity(db, admin);
        await db.query("update public.tickets set priority='high' where id=$1", [id]);
        await identity(db, employee);
        assert.equal(await submit(db, 'ticket', payload, token), id);
        assert.equal((await db.query('select * from public.tickets')).rows.length, 1);
        await denied(
          db,
          () => submit(db, 'ticket', { ...payload, title: 'Edited draft' }, token),
          /different input/,
        );
        assert.equal((await db.query('select * from public.tickets')).rows.length, 1);
      },
    );
    await scenario(
      'equipment association and first chat message each commit exactly once',
      async () => {
        for (const [kind, input, table] of [
          [
            'equipment',
            {
              asset: '60000000-0000-0000-0000-000000000401',
              title: 'Laptop request',
              description: 'Broken display',
              category_id: null,
            },
            'ticket_assets',
          ],
          ['chat', { topic: 'VPN support', message: 'Cannot connect' }, 'chat_messages'],
        ]) {
          const token = randomUUID(),
            id = await submit(db, kind, input, token);
          assert.equal(await submit(db, kind, input, token), id);
          await identity(db, admin);
          assert.equal((await db.query(`select * from public.${table}`)).rows.length, 1);
          await identity(db, employee);
        }
      },
    );
    await scenario(
      'failed creation rolls back both receipt and records, allowing a corrected retry',
      async () => {
        const token = randomUUID();
        await denied(
          db,
          () => submit(db, 'chat', { topic: 'VPN support', message: '' }, token),
          /check|constraint/,
        );
        assert.equal((await db.query('select * from public.chat_conversations')).rows.length, 0);
        assert.equal((await db.query('select * from private.support_submissions')).rows.length, 0);
        assert.ok(await submit(db, 'chat', { topic: 'VPN support', message: 'Now valid' }, token));
      },
    );
    await scenario(
      'employee writes retain ticket RLS and foreign tenant receipts remain invisible',
      async () => {
        await denied(
          db,
          () => submit(db, 'ticket', { ...payload, requester_id: admin }),
          /row-level security/,
        );
        await denied(
          db,
          () => submit(db, 'ticket', { ...payload, due_at: '2026-10-09T13:00:00Z' }),
          /row-level security/,
        );
        const token = randomUUID();
        await submit(db, 'ticket', payload, token);
        await identity(db, outsider);
        assert.equal((await db.query('select * from private.support_submissions')).rows.length, 0);
        await denied(db, () => submit(db, 'ticket', payload, token), /denied/);
      },
    );
    await scenario(
      'deactivated membership cannot replay a previously accepted submission',
      async () => {
        const token = randomUUID();
        await submit(db, 'ticket', payload, token);
        await identity(db, admin);
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",
          [org, employee],
        );
        await identity(db, employee);
        await denied(db, () => submit(db, 'ticket', payload, token), /denied/);
      },
    );
  } finally {
    await db.close();
  }
});
