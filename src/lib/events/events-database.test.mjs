import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { registry, validateEvent } from '../../../tests/fixtures/automation.mjs';

const ids = {
  admin: '10000000-0000-0000-0000-000000000401', otherAdmin: '10000000-0000-0000-0000-000000000402',
  worker: '10000000-0000-0000-0000-000000000403', employee: '10000000-0000-0000-0000-000000000404',
  org: '20000000-0000-0000-0000-000000000401', otherOrg: '20000000-0000-0000-0000-000000000402',
  department: '30000000-0000-0000-0000-000000000401', team: '40000000-0000-0000-0000-000000000401',
  category: '50000000-0000-0000-0000-000000000401', asset: '60000000-0000-0000-0000-000000000401',
};
async function identity(db, actor = ids.admin, role = 'authenticated', aal = 'aal1') {
  // Role values below are test constants, never application inputs.
  assert.ok(['authenticated', 'service_role', 'anon'].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role, aal })]);
}
const owner = db => db.exec('reset role');
async function expectError(db, sql, params, code) {
  await db.exec('savepoint expected_error');
  try { await assert.rejects(db.query(sql, params), { code }); }
  finally { await db.exec('rollback to savepoint expected_error; release savepoint expected_error'); }
}
async function ticket(db, { org = ids.org, requester = ids.employee, category = null, status = 'new' } = {}) {
  return (await db.query('insert into public.tickets(organization_id,requester_id,title,description,category_id,status) values($1,$2,$3,$4,$5,$6) returning *', [org, requester, 'Network request', 'SECRET_DESCRIPTION', category, status])).rows[0];
}
async function events(db, id) {
  await owner(db);
  return (await db.query('select private.domain_event_envelope(e) as event from private.domain_events e where entity_id=$1 order by entity_version,event_type', [id])).rows.map(row => row.event);
}
const types = items => items.map(event => event.type).sort();
const claim = async (db, batch = 20, seconds = 120) => (await db.query('select * from public.claim_domain_events($1,$2)', [batch, seconds])).rows;
const finish = async (db, delivery, outcome = 'acknowledged', code = null) => (await db.query('select public.finish_domain_event_delivery($1,$2,$3,$4) as done', [delivery.delivery_id, delivery.lease_token, outcome, code])).rows[0].done;

test('Stage 3 database capture and durable delivery', async t => {
  const db = await migratedPostgres();
  async function scenario(name, run) {
    await t.test(name, async () => {
      await db.exec('begin');
      try { await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8')); await identity(db); await run(); }
      finally { await db.exec('rollback'); }
    });
  }
  try {
    await scenario('normal creation captures routed final state, trusted actor and frozen requester department', async () => {
      const created = await ticket(db, { category: ids.category });
      const [event] = await events(db, created.id);
      assert.equal(created.revision, 1); assert.equal(event.type, 'ticket.created'); assert.equal(event.before, null);
      assert.equal(event.organizationId, ids.org); assert.equal(event.actorType, 'member'); assert.equal(event.actorId, ids.admin);
      assert.equal(event.after.team_id, ids.team); assert.equal(event.after.requester_department_id, ids.department);
      assert.equal(event.entityVersion, 1); assert.equal(event.rootEventId, event.id); assert.equal(event.depth, 0); assert.equal(event.causationId, null);
      assert.equal(validateEvent(event).valid, true); assert.equal(registry.trigger(event.type).matches(event, {}), true);
      assert.deepEqual(Object.keys(event.after).sort(), ['title', 'status', 'priority', 'category_id', 'subcategory_id', 'assigned_technician_id', 'team_id', 'requester_id', 'requester_department_id', 'location_id', 'due_at', 'first_response_at', 'created_at', 'unassigned_since', 'unassigned_episode_id', 'waiting_on_user_since', 'waiting_on_user_episode_id', 'response_sla_due_at', 'resolution_sla_due_at', 'resolved_at', 'closed_at'].sort());
      assert.doesNotMatch(JSON.stringify(event), /SECRET|email|description|storage_path/);
      await db.query('update public.profiles set department_id=null where organization_id=$1 and user_id=$2', [ids.org, ids.employee]);
      assert.equal((await events(db, created.id))[0].after.requester_department_id, ids.department);
      assert.equal((await db.query('select count(*)::integer n from private.domain_event_deliveries where event_id=$1', [event.id])).rows[0].n, 1);
    });
    await scenario('equipment creation captures one event in the existing atomic RPC', async () => {
      await identity(db, ids.employee);
      const { rows } = await db.query('select public.create_equipment_ticket($1,$2,$3,$4,$5) as id', [ids.org, ids.asset, 'Equipment issue', 'SECRET_EQUIPMENT_BODY', ids.category]);
      const captured = await events(db, rows[0].id);
      assert.deepEqual(types(captured), ['ticket.created']); assert.equal(captured[0].actorId, ids.employee); assert.equal(captured[0].after.team_id, ids.team);
      assert.equal((await db.query('select count(*)::integer n from public.ticket_assets where ticket_id=$1', [rows[0].id])).rows[0].n, 1);
    });
    await scenario('chat conversion captures one event and repeated conversion is idempotent', async () => {
      await identity(db, ids.employee);
      const chat = (await db.query('select public.start_support_chat($1,$2,$3) as id', [ids.org, 'Network support', 'SECRET_CHAT_BODY'])).rows[0].id;
      await identity(db);
      const first = (await db.query('select public.convert_chat_to_ticket($1) as id', [chat])).rows[0].id;
      assert.equal((await db.query('select public.convert_chat_to_ticket($1) as id', [chat])).rows[0].id, first);
      const captured = await events(db, first); assert.deepEqual(types(captured), ['ticket.created']); assert.equal(captured[0].after.status, 'open');
      assert.doesNotMatch(JSON.stringify(captured), /SECRET_CHAT_BODY/);
    });
    for (const [label, sql, params, expected] of [
      ['status change', 'status=$2', ['in_progress'], ['ticket.status_changed']],
      ['priority change', 'priority=$2', ['critical'], ['ticket.priority_changed']],
      ['technician assignment', 'assigned_technician_id=$2', [ids.worker], ['ticket.assigned']],
      ['team assignment', 'team_id=$2', [ids.team], ['ticket.assigned']],
      ['resolution', 'status=$2', ['resolved'], ['ticket.resolved', 'ticket.status_changed']],
      ['direct close', 'status=$2', ['closed'], ['ticket.resolved', 'ticket.status_changed']],
      ['sensitive description edit', 'description=$2', ['NEW_SECRET_BODY'], ['ticket.updated']],
      ['simultaneous changes', 'status=$2,priority=$3,assigned_technician_id=$4,title=$5', ['resolved', 'critical', ids.worker, 'Changed subject'], ['ticket.assigned', 'ticket.priority_changed', 'ticket.resolved', 'ticket.status_changed', 'ticket.updated']],
    ]) await scenario(label, async () => {
      const created = await ticket(db);
      await db.query(`update public.tickets set ${sql} where id=$1`, [created.id, ...params]);
      const changes = (await events(db, created.id)).filter(event => event.entityVersion === 2);
      assert.deepEqual(types(changes), expected);
      assert.equal(new Set(changes.map(event => event.correlationId)).size, 1);
      for (const event of changes) {
        assert.equal(validateEvent(event).valid, true, JSON.stringify(event));
        assert.equal(registry.trigger(event.type).matches(event, {}), true, event.type);
        assert.equal(event.before.status, 'new'); assert.equal(event.before.priority, 'normal');
        assert.doesNotMatch(JSON.stringify(event), /NEW_SECRET_BODY|SECRET_DESCRIPTION/);
      }
    });
    await scenario('unassignment is updated; resolved-to-closed does not resolve twice', async () => {
      const created = await ticket(db);
      await db.query("update public.tickets set assigned_technician_id=$2,status='resolved' where id=$1", [created.id, ids.worker]);
      await db.query("update public.tickets set assigned_technician_id=null,status='closed' where id=$1", [created.id]);
      assert.deepEqual(types((await events(db, created.id)).filter(event => event.entityVersion === 3)), ['ticket.status_changed', 'ticket.updated']);
    });
    await scenario('employee reopening preserves restrictions, advances revision and clears resolution time', async () => {
      const created = await ticket(db, { status: 'resolved' });
      await identity(db, ids.employee);
      await expectError(db, "update public.tickets set status='open',title='Forged subject' where id=$1", [created.id], 'P0001');
      await db.query("update public.tickets set status='open' where id=$1", [created.id]);
      const current = (await db.query('select revision,resolved_at from public.tickets where id=$1', [created.id])).rows[0];
      assert.equal(current.revision, 2); assert.equal(current.resolved_at, null);
      assert.deepEqual(types((await events(db, created.id)).filter(event => event.entityVersion === 2)), ['ticket.status_changed']);
    });
    await scenario('bulk update captures each affected ticket and each independent event', async () => {
      const first = await ticket(db); const second = await ticket(db);
      await db.query("update public.tickets set status='open',priority='high' where organization_id=$1 and id=any($2::uuid[])", [ids.org, [first.id, second.id]]);
      for (const row of [first, second]) assert.deepEqual(types((await events(db, row.id)).filter(event => event.entityVersion === 2)), ['ticket.priority_changed', 'ticket.status_changed']);
    });
    await scenario('no-op and chronology-only updates create neither revisions nor events', async () => {
      const created = await ticket(db);
      await db.query('update public.tickets set status=status,priority=priority,title=title where id=$1', [created.id]);
      await owner(db); await db.query("update public.tickets set updated_at=now()+interval '1 hour' where id=$1", [created.id]);
      assert.equal((await db.query('select revision from public.tickets where id=$1', [created.id])).rows[0].revision, 1);
      assert.equal((await events(db, created.id)).length, 1);
    });
    await scenario('revision is server-owned even for privileged callers; no client column grants', async () => {
      const created = await ticket(db);
      await expectError(db, 'update public.tickets set revision=700 where id=$1', [created.id], '42501');
      await expectError(db, 'insert into public.tickets(organization_id,requester_id,title,description,revision) values($1,$2,$3,$4,700)', [ids.org, ids.admin, 'Forged version', 'Body'], '42501');
      await owner(db); await db.query('update public.tickets set revision=700 where id=$1', [created.id]);
      assert.equal((await db.query('select revision from public.tickets where id=$1', [created.id])).rows[0].revision, 1);
      await db.query("update public.tickets set revision=900,priority='high' where id=$1", [created.id]);
      assert.equal((await db.query('select revision from public.tickets where id=$1', [created.id])).rows[0].revision, 2);
    });
    await scenario('transaction/savepoint rollback removes ticket mutations, events and deliveries', async () => {
      const original = await ticket(db);
      await db.exec('savepoint mutation');
      const discarded = await ticket(db);
      await db.query("update public.tickets set priority='high' where id=$1", [original.id]);
      await db.exec('rollback to savepoint mutation; release savepoint mutation');
      assert.equal((await events(db, discarded.id)).length, 0); assert.equal((await events(db, original.id)).length, 1);
      assert.equal((await db.query('select count(*)::integer n from private.domain_event_deliveries')).rows[0].n, 1);
    });
    await scenario('delivery insertion failure rolls back the ticket and its event', async () => {
      await owner(db); await db.exec("alter table private.domain_event_deliveries add constraint test_failure check(consumer<>'automation')");
      await identity(db);
      await expectError(db, 'insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,$3,$4)', [ids.org, ids.admin, 'Fail atomically', 'Body'], '23514');
      await owner(db);
      for (const table of ['public.tickets', 'private.domain_events', 'private.domain_event_deliveries']) assert.equal((await db.query(`select count(*)::integer n from ${table}`)).rows[0].n, 0);
    });
    await scenario('public staff reply captures first response without copying the reply or changing SLA logic', async () => {
      const created = await ticket(db);
      await identity(db, ids.worker);
      await db.query("insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','SECRET_REPLY')", [ids.org, created.id, ids.worker]);
      const changed = (await events(db, created.id)).filter(event => event.entityVersion === 2);
      assert.deepEqual(types(changed), ['ticket.updated']); assert.deepEqual(changed[0].changedFields, ['first_response_at']); assert.doesNotMatch(JSON.stringify(changed), /SECRET_REPLY/);
    });
    await scenario('both tenant directions remain isolated and event/delivery access is infrastructure-only', async () => {
      await ticket(db); await identity(db, ids.otherAdmin); await ticket(db, { org: ids.otherOrg, requester: ids.otherAdmin });
      await owner(db);
      assert.deepEqual((await db.query('select organization_id from private.domain_events order by organization_id')).rows.map(row => row.organization_id), [ids.org, ids.otherOrg]);
      assert.equal((await db.query("select bool_and(relrowsecurity) ok from pg_class where oid in ('private.domain_events'::regclass,'private.domain_event_deliveries'::regclass)")).rows[0].ok, true);
      for (const actor of [ids.admin, ids.otherAdmin, ids.worker, ids.employee]) {
        await identity(db, actor);
        for (const table of ['private.domain_events', 'private.domain_event_deliveries']) {
          await expectError(db, `select * from ${table}`, [], '42501');
          await expectError(db, `insert into ${table}(id) values(gen_random_uuid())`, [], '42501');
          await expectError(db, `delete from ${table}`, [], '42501');
        }
        await expectError(db, 'select * from public.claim_domain_events()', [], '42501');
        await expectError(db, "select public.finish_domain_event_delivery(gen_random_uuid(),gen_random_uuid(),'acknowledged')", [], '42501');
        await expectError(db, 'select * from private.claim_domain_events(1,120,\'automation\')', [], '42501');
        await expectError(db, 'select private.publish_domain_event($1,$2,$3,gen_random_uuid(),1,null,$4,$5,gen_random_uuid())', [ids.org, 'ticket.created', 'ticket', '{}', []], '42501');
      }
      await identity(db, null, 'anon'); await expectError(db, 'select * from public.claim_domain_events()', [], '42501');
      await identity(db, null, 'service_role');
      for (const table of ['private.domain_events', 'private.domain_event_deliveries']) await expectError(db, `select * from ${table}`, [], '42501');
      const leased = await claim(db); assert.equal(leased.length, 2); assert.deepEqual(leased.map(row => row.event.organizationId).sort(), [ids.org, ids.otherOrg]);
      await expectError(db, 'select private.publish_domain_event($1,$2,$3,gen_random_uuid(),1,null,$4,$5,gen_random_uuid())', [ids.org, 'ticket.created', 'ticket', '{}', []], '42501');
    });
    await scenario('MFA and cross-tenant ticket mutation denial cannot manufacture an event', async () => {
      await owner(db); await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),$1,'totp','verified',now(),now())", [ids.admin]);
      await identity(db);
      await expectError(db, 'insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,$3,$4)', [ids.org, ids.admin, 'MFA denied', 'Body'], '42501');
      await identity(db, ids.admin, 'authenticated', 'aal2');
      await expectError(db, 'insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,$3,$4)', [ids.otherOrg, ids.otherAdmin, 'Foreign tenant', 'Body'], '42501');
      await owner(db); assert.equal((await db.query('select count(*)::integer n from private.domain_events')).rows[0].n, 0);
    });
    await scenario('direct service grants remain constrained; trusted maintenance writes retain system provenance', async () => {
      const original = await ticket(db); await identity(db, null, 'service_role');
      // Direct service access first fails the existing private helper grant.
      await expectError(db, "update public.tickets set priority='high' where id=$1", [original.id], '42501');
      // Existing can_work_tickets returns NULL for an absent membership. The
      // invoker guard is not a replacement for a future definer RPC's own auth.
      await owner(db);
      assert.equal((await db.query('select private.can_work_tickets($1) as allowed', [ids.org])).rows[0].allowed, null);
      await db.query("update public.tickets set priority='high' where id=$1", [original.id]);
      const changed = (await events(db, original.id)).filter(event => event.entityVersion === 2);
      assert.deepEqual(types(changed), ['ticket.priority_changed']);
      assert.equal(changed[0].actorType, 'system'); assert.equal(changed[0].actorId, null);
    });
    await scenario('claims are bounded, lease-exclusive and acknowledgements are fenced and idempotent', async () => {
      await ticket(db); await ticket(db); await identity(db, null, 'service_role');
      for (const [batch, seconds] of [[0, 120], [101, 120], [null, 120], [1, 0], [1, 901], [1, null]]) await expectError(db, 'select * from public.claim_domain_events($1,$2)', [batch, seconds], '22023');
      const [first] = await claim(db, 1); const [second] = await claim(db, 1);
      assert.notEqual(first.delivery_id, second.delivery_id); assert.equal((await claim(db)).length, 0); assert.equal(first.attempts, 1);
      assert.equal(await finish(db, { ...first, lease_token: second.lease_token }), false);
      assert.equal(await finish(db, first), true); assert.equal(await finish(db, first), true);
      assert.equal(await finish(db, first, 'failed', 'permanent_failure'), false);
      await expectError(db, 'select public.finish_domain_event_delivery($1,$2,$3,$4)', [second.delivery_id, second.lease_token, 'failed', 'SECRET_CREDENTIAL'], '22023');
    });
    await scenario('expired lease reclaim rotates tokens; old and expired acknowledgements fail', async () => {
      await ticket(db); await identity(db, null, 'service_role'); const [first] = await claim(db);
      await owner(db); await db.query("update private.domain_event_deliveries set leased_at=now()-interval '3 minutes',lease_expires_at=now()-interval '1 minute',available_at=now()-interval '1 minute' where id=$1", [first.delivery_id]);
      await identity(db, null, 'service_role'); assert.equal(await finish(db, first), false);
      const [next] = await claim(db); assert.equal(next.delivery_id, first.delivery_id); assert.notEqual(next.lease_token, first.lease_token); assert.equal(next.attempts, 2);
      assert.equal(await finish(db, first), false); assert.equal(await finish(db, next), true);
    });
    await scenario('retry backoff, terminal failure and exhausted attempts are durable', async () => {
      await ticket(db); await identity(db, null, 'service_role'); const [first] = await claim(db);
      assert.equal(await finish(db, first, 'retry', 'transient_failure'), true); assert.equal(await finish(db, first, 'retry', 'transient_failure'), true);
      assert.equal((await claim(db)).length, 0);
      await owner(db); const pending = (await db.query('select * from private.domain_event_deliveries where id=$1', [first.delivery_id])).rows[0];
      assert.equal(pending.status, 'pending'); assert.equal(new Date(pending.available_at) - new Date(pending.updated_at), 30000);
      await db.query("update private.domain_event_deliveries set available_at=clock_timestamp()-interval '1 second',attempts=7 where id=$1", [first.delivery_id]);
      await identity(db, null, 'service_role'); const [last] = await claim(db); assert.equal(last.attempts, 8);
      assert.equal(await finish(db, last, 'retry', 'transient_failure'), true); assert.equal((await claim(db)).length, 0);
      await owner(db); assert.equal((await db.query('select status from private.domain_event_deliveries where id=$1', [last.delivery_id])).rows[0].status, 'dead');
    });
    await scenario('expiry at final attempt is dead-lettered instead of leased forever', async () => {
      await ticket(db); await identity(db, null, 'service_role'); const [first] = await claim(db);
      await owner(db); await db.query("update private.domain_event_deliveries set attempts=8,leased_at=now()-interval '3 minutes',lease_expires_at=now()-interval '1 minute',available_at=now()-interval '1 minute' where id=$1", [first.delivery_id]);
      await identity(db, null, 'service_role'); assert.equal((await claim(db)).length, 0);
      await owner(db); assert.equal((await db.query('select error_code from private.domain_event_deliveries where id=$1', [first.delivery_id])).rows[0].error_code, 'retry_exhausted');
    });
    await scenario('forged client causation is ignored; service causation derives from a live same-tenant lease', async () => {
      const original = await ticket(db); await identity(db, null, 'service_role'); const [parent] = await claim(db);
      await db.query("select set_config('app.domain_event_delivery',$1,true),set_config('app.domain_event_lease',$2,true)", [parent.delivery_id, parent.lease_token]);
      await identity(db); const human = await ticket(db); const [humanEvent] = await events(db, human.id);
      assert.equal(humanEvent.depth, 0); assert.equal(humanEvent.causationId, null);
      await identity(db, null, 'service_role'); const system = await ticket(db); const [child] = await events(db, system.id);
      assert.equal(child.actorType, 'system'); assert.equal(child.actorId, null); assert.equal(child.depth, 1); assert.equal(child.causationId, parent.event.id);
      assert.equal(child.rootEventId, parent.event.rootEventId); assert.equal(child.correlationId, parent.event.correlationId); assert.equal(validateEvent(child).valid, true);
      await identity(db, null, 'service_role');
      await expectError(db, 'insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,$3,$4)', [ids.otherOrg, ids.otherAdmin, 'Foreign cause', 'Body'], '42501');
      assert.equal(await finish(db, parent), true);
      await expectError(db, 'insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,$3,$4)', [ids.org, ids.employee, 'Expired context', 'Body'], '42501');
      assert.equal((await events(db, original.id)).length, 1);
    });
    await scenario('immutable events and unique delivery identity prevent duplicate records', async () => {
      const created = await ticket(db); const [event] = await events(db, created.id);
      await expectError(db, "update private.domain_events set after_snapshot='{}' where id=$1", [event.id], '42501');
      await expectError(db, 'delete from private.domain_events where id=$1', [event.id], '42501');
      await expectError(db, 'insert into private.domain_event_deliveries(organization_id,event_id) values($1,$2)', [ids.org, event.id], '23505');
      await expectError(db, 'insert into private.domain_event_deliveries(organization_id,event_id) values($1,$2)', [ids.otherOrg, event.id], '23503');
      const result = (await db.query('select private.publish_domain_event($1,$2,$3,$4,$5,$6,$7,$8,$9) id', [ids.org, event.type, event.entityType, event.entityId, event.entityVersion, null, JSON.stringify(event.after), event.changedFields, event.correlationId])).rows[0];
      assert.equal(result.id, event.id); assert.equal((await events(db, created.id)).length, 1);
      await expectError(db, 'select private.publish_domain_event($1,$2,$3,$4,$5,$6,$7,$8,$9)', [ids.org, event.type, event.entityType, event.entityId, event.entityVersion, null, '{}', event.changedFields, event.correlationId], '23505');
    });
    for (const name of ['category-routing-regression', 'sla-regression', 'notification-regression', 'security-regression']) {
      await t.test(`unchanged ${name} SQL suite`, async () => { await db.exec(await readFile(`supabase/tests/${name}.sql`, 'utf8')); });
    }
    await t.test('unchanged employee reopening pgTAP suite', async () => {
      const result = await db.exec(await readFile('supabase/tests/database/employee_reopen.test.sql', 'utf8'));
      const output = result.flatMap(item => item.rows.flatMap(row => Object.values(row))).filter(value => typeof value === 'string');
      assert.ok(output.includes('1..4')); assert.equal(output.filter(line => /^ok \d+/.test(line)).length, 4);
      assert.equal(output.some(line => /not ok|Bail out!|Looks like you/.test(line)), false, output.join('\n'));
    });
  } finally { await db.close(); }
});

test('revision migration initializes existing tickets without artificial events, audit or chronology changes', async () => {
  let original; let auditCount;
  const db = await migratedPostgres({ beforeMigration: async (db, name) => {
    if (name !== '20261001020338_durable_domain_events.sql') return;
    await db.exec('begin');
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await identity(db); original = await ticket(db); await owner(db);
    auditCount = (await db.query('select count(*)::integer n from public.audit_events')).rows[0].n;
    await db.exec('commit');
  } });
  try {
    const current = (await db.query('select * from public.tickets where id=$1', [original.id])).rows[0];
    assert.deepEqual(current, { ...original, revision: 1, unassigned_since: null, unassigned_episode_id: null, waiting_on_user_since: null, waiting_on_user_episode_id: null });
    assert.equal((await db.query('select count(*)::integer n from public.audit_events')).rows[0].n, auditCount);
    assert.equal((await db.query('select count(*)::integer n from private.domain_events')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::integer n from private.domain_event_deliveries')).rows[0].n, 0);
  } finally { await db.close(); }
});
