import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { identity, ids, owner, seed } from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const dept = '30000000-0000-0000-0000-000000000401';
async function denied(db, fn) {
  await db.exec('savepoint deny');
  try {
    await assert.rejects(fn);
  } finally {
    await db.exec('rollback to deny;release savepoint deny');
  }
}
const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
const command = async (db, name, payload) =>
  (
    await rows(db, 'select public.inventory_command($1,$2,$3,$4) id', [
      ids.org,
      name,
      randomUUID(),
      payload,
    ])
  )[0].id;

test('asset batch updates preserve identity, reject stale previews atomically and maintain private assignment history', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    await identity(db);
    const asset = (
      await rows(db, 'select * from public.assets where organization_id=$1', [ids.org])
    )[0];
    const record = {
      tag: asset.tag,
      name: 'Updated laptop',
      kind: 'computer',
      status: 'available',
      assigned_user_id: ids.employee,
      end_of_life_on: '2030-01-01',
    };
    const save = async (records, expected) =>
      rows(db, 'select public.import_asset_updates($1,$2,$3)', [
        ids.org,
        JSON.stringify(records),
        JSON.stringify(expected),
      ]);
    await save([record], { [asset.tag]: String(asset.revision) });
    assert.equal(
      (await rows(db, 'select id from public.assets where tag=$1', [asset.tag]))[0].id,
      asset.id,
    );
    assert.equal(
      (await rows(db, 'select * from public.asset_assignments where asset_id=$1', [asset.id]))
        .length,
      1,
      'unchanged assignment creates no duplicate history',
    );
    await denied(db, () => save([{ ...record, name: 'Stale' }], { [asset.tag]: '0' }));
    const current = (await rows(db, 'select * from public.assets where id=$1', [asset.id]))[0];
    await denied(db, () =>
      save(
        [
          { ...record, name: 'Must roll back' },
          { tag: 'INVALID', name: 'x', kind: 'computer', status: 'available' },
        ],
        { [asset.tag]: String(current.revision) },
      ),
    );
    assert.equal(
      (await rows(db, 'select name from public.assets where id=$1', [asset.id]))[0].name,
      'Updated laptop',
    );
    await save([{ ...record, assigned_user_id: ids.worker }], {
      [asset.tag]: String(current.revision),
    });
    const history = await rows(
      db,
      'select * from public.asset_assignments where asset_id=$1 order by recorded_at,id',
      [asset.id],
    );
    assert.equal(history.length, 2);
    assert.equal(history.filter((r) => r.returned_at === null).length, 1);
    assert.equal(history.find((r) => r.user_id === ids.employee).returned_at !== null, true);
    await denied(db, () => save([{ ...record, tag: 'NEW-BAD', purchased_on: '2031-01-01' }], {}));
    await save([{ ...record, tag: 'NEW-ROUNDTRIP', assigned_user_id: null }], {});
    await denied(db, () => save([{ ...record, tag: 'NEW-ROUNDTRIP', name: 'Concurrent tag' }], {}));
    await identity(db, 'authenticated', ids.employee);
    assert.equal((await rows(db, 'select * from public.asset_assignments')).length, 0);
    await denied(db, () => save([record], {}));
    await identity(db, 'authenticated', ids.otherAdmin);
    assert.equal((await rows(db, 'select * from public.asset_assignments')).length, 0);
    await denied(db, () => save([record], {}));
  } finally {
    await db.close();
  }
});

test('low-stock episodes use available stock, notify capability holders once, cancel pending mail on recovery and rearm', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    const location = randomUUID();
    await db.query("insert into public.locations(id,organization_id,name) values($1,$2,'Store')", [
      location,
      ids.org,
    ]);
    await owner(db);
    await db.exec('update auth.users set email_confirmed_at=now()');
    await identity(db);
    await command(db, 'permissions', { id: ids.admin, manager: true, departments: [dept] });
    await command(db, 'permissions', { id: ids.employee, manager: true, departments: [dept] });
    const item = await command(db, 'create', {
      name: 'Toner',
      kind: 'consumable',
      department: dept,
      location,
    });
    await command(db, 'receive', { id: item, quantity: 5 });
    const threshold = (n, expected) =>
      rows(db, 'select public.set_inventory_reorder_threshold($1,$2,$3,$4)', [
        ids.org,
        item,
        n,
        expected,
      ]);
    await threshold(4, null);
    assert.equal(
      (await rows(db, 'select * from public.notifications where inventory_item_id=$1', [item]))
        .length,
      0,
      'stock above threshold does not alert',
    );
    await identity(db, 'authenticated', ids.employee);
    const request = await command(db, 'request', {
      id: item,
      quantity: 2,
      destination: 'Engineering office',
    });
    await identity(db);
    await command(db, 'approve', { id: request });
    const reserved = (
      await rows(db, 'select stock,reserved from public.inventory_items where id=$1', [item])
    )[0];
    assert.equal(
      reserved.stock - reserved.reserved,
      3,
      'approved reservations reduce available stock',
    );
    assert.equal(
      (await rows(db, 'select * from public.notifications where inventory_item_id=$1', [item]))
        .length,
      1,
      'reservation crossing triggers the first low-stock alert',
    );
    await threshold(4, 4);
    await command(db, 'correct', { id: item, quantity: -1, note: 'Count correction' });
    assert.equal(
      (await rows(db, 'select * from public.notifications where inventory_item_id=$1', [item]))
        .length,
      1,
      'further decline does not send another alert',
    );
    await denied(db, () => threshold(9, null));
    await command(db, 'receive', { id: item, quantity: 10 });
    await owner(db);
    await owner(db);
    assert.equal(
      (
        await rows(
          db,
          "select count(*)::int n from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.inventory_item_id=$1 and q.status='pending'",
          [item],
        )
      )[0].n,
      0,
    );
    await identity(db);
    await command(db, 'correct', { id: item, quantity: -10, note: 'Recount' });
    assert.equal(
      (await rows(db, 'select * from public.notifications where inventory_item_id=$1', [item]))
        .length,
      2,
      'recovery arms a new episode',
    );
    await identity(db, 'authenticated', ids.employee);
    assert.equal(
      (await rows(db, 'select * from public.notifications where inventory_item_id=$1', [item]))
        .length,
      2,
      'employee-role inventory manager receives stock alerts',
    );
    await threshold(null, 4);
    await identity(db);
    await command(db, 'permissions', { id: ids.employee, manager: false, departments: [] });
    await identity(db, 'authenticated', ids.employee);
    assert.equal(
      (await rows(db, 'select * from public.notifications where inventory_item_id=$1', [item]))
        .length,
      0,
      'revocation hides historical stock alerts',
    );
    await denied(db, () => threshold(0, null));
    await identity(db, 'authenticated', ids.otherAdmin);
    await denied(db, () => threshold(0, null));
  } finally {
    await db.close();
  }
});

test('lifecycle reminders are bounded, staff-only, deduplicated per date and milestone, and use the email outbox', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    await db.exec('update auth.users set email_confirmed_at=now()');
    await identity(db);
    const asset = (
      await rows(db, 'select * from public.assets where organization_id=$1', [ids.org])
    )[0];
    await db.query(
      'update public.assets set warranty_until=current_date+20,end_of_life_on=current_date-1 where id=$1',
      [asset.id],
    );
    await denied(db, () => rows(db, 'select public.process_equipment_reminders(100)'));
    await identity(db, 'service_role', null);
    await rows(db, 'select public.process_equipment_reminders(1)');
    await rows(db, 'select public.process_equipment_reminders(1)');
    let notices = await rows(db, 'select * from public.notifications where asset_id=$1', [
      asset.id,
    ]);
    assert.equal(notices.length, 4, 'two milestones for two active IT staff');
    assert.ok(notices.every((n) => n.staff_only && n.kind === 'asset_lifecycle'));
    await owner(db);
    assert.equal(
      (
        await rows(
          db,
          'select * from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.asset_id=$1 and q.email_reason_version=1',
          [asset.id],
        )
      ).length,
      4,
    );
    await identity(db, 'authenticated', ids.employee);
    assert.equal(
      (await rows(db, 'select * from public.notifications where asset_id=$1', [asset.id])).length,
      0,
    );
    await identity(db);
    await db.query('update public.assets set warranty_until=current_date-1 where id=$1', [
      asset.id,
    ]);
    await identity(db, 'service_role', null);
    await rows(db, 'select public.process_equipment_reminders(100)');
    notices = await rows(db, 'select * from public.notifications where asset_id=$1', [asset.id]);
    assert.equal(notices.length, 6, 'changed date gets a new milestone');
    await identity(db);
    await db.query("update public.assets set assigned_user_id=null,status='retired' where id=$1", [
      asset.id,
    ]);
    await identity(db, 'service_role', null);
    await rows(db, 'select * from public.claim_notification_emails(20)');
    await owner(db);
    assert.equal(
      (
        await rows(
          db,
          "select count(*)::int n from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.asset_id=$1 and q.status<>'skipped'",
          [asset.id],
        )
      )[0].n,
      0,
      'retirement cancels unsent reminders',
    );
  } finally {
    await db.close();
  }
});

test('reminder milestones use the organization calendar and notify again when the same date is reached', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    await db.query("update public.organizations set timezone='Etc/GMT+12' where id=$1", [ids.org]);
    await identity(db);
    const asset = (
      await rows(db, 'select * from public.assets where organization_id=$1', [ids.org])
    )[0];
    await db.query(
      "update public.assets set warranty_until=(now() at time zone 'Etc/GMT+12')::date+1 where id=$1",
      [asset.id],
    );
    await identity(db, 'service_role', null);
    await rows(db, 'select public.process_equipment_reminders(100)');
    assert.equal(
      (
        await rows(
          db,
          "select * from public.notifications where asset_id=$1 and event_key like '%:soon'",
          [asset.id],
        )
      ).length,
      2,
    );
    await owner(db);
    await db.query("update public.organizations set timezone='Pacific/Kiritimati' where id=$1", [
      ids.org,
    ]);
    await identity(db, 'service_role', null);
    await rows(db, 'select public.process_equipment_reminders(100)');
    await rows(db, 'select public.process_equipment_reminders(100)');
    assert.equal(
      (
        await rows(
          db,
          "select * from public.notifications where asset_id=$1 and event_key like '%:due'",
          [asset.id],
        )
      ).length,
      2,
    );
    assert.equal(
      (await rows(db, 'select * from public.notifications where asset_id=$1', [asset.id])).length,
      4,
    );
  } finally {
    await db.close();
  }
});
