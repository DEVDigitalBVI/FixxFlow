import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('IT adds employee followers, publishes approved updates and removes future recipients without ticket access', async () => {
  const db = await migratedPostgres();
  const org = '20000000-0000-0000-0000-000000000401';
  const admin = '10000000-0000-0000-0000-000000000401';
  const owner = '10000000-0000-0000-0000-000000000403';
  const employee = '10000000-0000-0000-0000-000000000404';
  const foreign = '10000000-0000-0000-0000-000000000402';
  const gm = randomUUID();
  async function identity(id) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.exec('set role authenticated');
  }
  async function rejects(run, pattern) {
    await db.exec('savepoint expected_failure');
    try {
      await assert.rejects(run, pattern);
    } finally {
      await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
    }
  }
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
      gm,
      'gm@example.invalid',
    ]);
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'end_user')",
      [org, gm],
    );
    await db.exec('begin');
    await identity(admin);
    const ticket = (
      await db.query('select public.submit_incident_ticket($1,$2,$3) id', [
        org,
        randomUUID(),
        {
          requester_id: employee,
          title: 'Office outage',
          description: 'Private diagnosis',
          priority: 'normal',
          routing_mode: 'automatic',
          incident: {
            severity: 'major',
            business_impact: 'Private internal impact',
            owner_id: owner,
            affected_services: [],
            affected_locations: [],
          },
        },
      ])
    ).rows[0].id;
    const follow = async (person, rev, operation = 'add', organization = org) =>
      (
        await db.query('select public.manage_incident_follower($1,$2,$3,$4,$5) rev', [
          organization,
          ticket,
          person,
          rev,
          operation,
        ])
      ).rows[0].rev;
    const before = (
      await db.query('select assigned_technician_id,status from public.tickets where id=$1', [
        ticket,
      ])
    ).rows[0];
    let revision = await follow(gm, 0);
    assert.deepEqual(
      (
        await db.query('select assigned_technician_id,status from public.tickets where id=$1', [
          ticket,
        ])
      ).rows[0],
      before,
    );
    assert.equal(
      await follow(gm, 0),
      revision,
      'lost-response retries do not duplicate membership',
    );
    await rejects(() => follow(employee, 0), /changed/);
    await rejects(() => follow(foreign, revision), /active company/);
    const groups = (
      await db.query('select * from public.incident_stakeholder_groups where is_follower_group')
    ).rows;
    assert.equal(groups.length, 1);
    const group = groups[0].id;
    const command = async (operation, id, rev, payload = {}) =>
      (
        await db.query('select public.manage_incident_communication($1,$2,$3,$4,$5,$6) rev', [
          org,
          ticket,
          id,
          rev,
          operation,
          payload,
        ])
      ).rows[0].rev;
    await identity(gm);
    await rejects(() => follow(employee, revision), /denied/);
    assert.equal(
      (await db.query('select id from public.tickets where id=$1', [ticket])).rows.length,
      0,
    );
    assert.equal(
      (await db.query('select * from public.incident_stakeholder_members')).rows.length,
      0,
    );
    await identity(foreign);
    await rejects(
      () => follow(foreign, 0, 'add', '20000000-0000-0000-0000-000000000402'),
      /Declare an incident/,
    );
    await identity(owner);
    const draft = randomUUID();
    let draftRevision = await command('save_draft', draft, 0, {
      title: 'Outage progress',
      body: 'Service restoration is in progress.',
      group_ids: [group],
    });
    assert.deepEqual(
      (
        await db.query('select recipient_ids from public.incident_update_drafts where id=$1', [
          draft,
        ])
      ).rows[0].recipient_ids,
      [gm],
    );
    await command('publish', draft, draftRevision);
    await db.exec('reset role');
    await db.exec(
      "update private.notification_email_outbox set available_at=now()-interval '1 minute'",
    );
    await db.exec('set role service_role');
    const delivery = (
      await db.query('select * from public.claim_notification_emails(20)')
    ).rows.find((n) => n.incident_bulletin_id === draft);
    assert.ok(delivery);
    assert.equal(delivery.recipient_email, 'gm@example.invalid');
    assert.equal(delivery.approved_body, 'Service restoration is in progress.');
    await identity(gm);
    const bulletin = (
      await db.query('select * from public.incident_bulletins where id=$1', [draft])
    ).rows[0];
    assert.equal(bulletin.body, 'Service restoration is in progress.');
    assert.ok(!JSON.stringify(bulletin).includes('Private'));
    assert.equal(
      (await db.query("select id from public.notifications where kind='incident_update'", [])).rows
        .length,
      1,
    );
    await identity(owner);
    revision = await follow(gm, revision, 'remove');
    assert.equal(await follow(gm, revision - 1, 'remove'), revision);
    const next = randomUUID();
    await rejects(
      () =>
        command('save_draft', next, 0, {
          title: 'Next update',
          body: 'Service is restored.',
          group_ids: [group],
        }),
      /recipient|member/i,
    );
    await identity(gm);
    assert.equal(
      (await db.query('select id from public.incident_bulletins where id=$1', [draft])).rows.length,
      1,
      'removal does not recall approved messages',
    );
    assert.equal(
      (await db.query('select id from public.tickets where id=$1', [ticket])).rows.length,
      0,
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
