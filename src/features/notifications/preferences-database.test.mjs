import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  identity,
  ids,
  owner,
  seed,
  service,
  ticket,
} from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const defaults = {
  email_mode: 'daily',
  timezone: 'UTC',
  digest_hour: 0,
  quiet_enabled: false,
  quiet_start: '22:00',
  quiet_end: '07:00',
  urgent_immediate: false,
};
async function prefs(db, values = {}, actor = ids.employee, org = ids.org, revision = 0) {
  await identity(db, 'authenticated', actor);
  return (
    await one(db, 'select public.save_notification_preferences($1,$2,$3) revision', [
      org,
      revision,
      { ...defaults, ...values },
    ])
  ).revision;
}
async function enqueue(db, recipient = ids.employee) {
  const t = await ticket(db);
  await owner(db);
  await db.query(
    "select private.enqueue_notification($1,$2,null,$3,null,'ticket_response','IT replied',false,$4)",
    [ids.org, recipient, t.id, randomUUID()],
  );
  await db.exec(
    "update private.notification_email_outbox set available_at=now()-interval '1 minute'",
  );
  return t;
}
async function denied(db, sql, args = []) {
  await db.exec('savepoint rejected');
  try {
    await assert.rejects(db.query(sql, args));
  } finally {
    await db.exec('rollback to rejected;release savepoint rejected');
  }
}
// Advance only the due instant in the isolated database; all authorization and
// validation triggers remain active when the real dispatcher is invoked.
async function makeDue(db) {
  await owner(db);
  await db.exec(
    "update public.notification_preferences set digest_not_before=now()-interval '2 days';update public.notifications n set created_at=least(n.created_at,private.notification_digest_slot(p,now())-interval '1 minute') from public.notification_preferences p where p.organization_id=n.organization_id and p.user_id=n.recipient_id and p.email_mode='daily'",
  );
}
async function claim(db) {
  await service(db);
  return (await db.query('select * from public.claim_notification_digests(3)')).rows;
}

test('notification preferences and digest delivery preserve tenant boundaries and retry receipts', async (t) => {
  const db = await migratedPostgres();
  try {
    async function scenario(name, fn) {
      await t.test(name, async () => {
        await db.exec('begin');
        try {
          await seed(db);
          await db.exec('update auth.users set email_confirmed_at=now()');
          await fn();
        } finally {
          await db.exec('rollback');
        }
      });
    }
    await scenario(
      'members save only their own settings, revisions reject stale edits, timezone and equal quiet times validated',
      async () => {
        assert.equal(await prefs(db), 1);
        assert.equal(
          (
            await one(
              db,
              'select digest_not_before>now() future from public.notification_preferences',
            )
          ).future,
          true,
        );
        await denied(db, 'select public.save_notification_preferences($1,0,$2)', [
          ids.org,
          defaults,
        ]);
        assert.equal(await prefs(db, { email_mode: 'off' }, ids.employee, ids.org, 1), 2);
        await identity(db, 'authenticated', ids.otherAdmin);
        assert.equal(
          (await db.query('select * from public.notification_preferences')).rows.length,
          0,
        );
        await denied(db, 'select public.save_notification_preferences($1,0,$2)', [
          ids.org,
          defaults,
        ]);
        await identity(db, 'authenticated', ids.admin);
        assert.equal(
          (await db.query('select * from public.notification_preferences')).rows.length,
          0,
        );
        await denied(db, 'select public.save_notification_preferences($1,0,$2)', [
          ids.org,
          { ...defaults, timezone: 'Bad/Zone' },
        ]);
        await denied(db, 'select public.save_notification_preferences($1,0,$2)', [
          ids.org,
          { ...defaults, quiet_enabled: true, quiet_start: '07:00', quiet_end: '07:00' },
        ]);
        await denied(db, 'select public.claim_notification_digests(3)');
      },
    );
    await scenario(
      'quiet hours cross midnight, honor boundaries and convert DST using saved timezone',
      async () => {
        const base = { ...defaults, quiet_enabled: true, timezone: 'America/New_York' };
        const quiet = async (stamp, p = base) =>
          (
            await one(
              db,
              'select private.notification_quiet(jsonb_populate_record(null::public.notification_preferences,$1),$2) q',
              [p, stamp],
            )
          ).q;
        assert.equal(await quiet('2026-10-28T02:00:00Z'), true);
        assert.equal(await quiet('2026-10-28T11:00:00Z'), false);
        assert.equal(await quiet('2026-11-01T05:30:00Z'), true);
        assert.equal(await quiet('2026-11-01T06:30:00Z'), true);
        assert.equal(await quiet('2026-11-01T12:00:00Z'), false);
        assert.equal(await quiet('2026-03-08T07:30:00Z'), true);
        const slot = await one(
          db,
          "select private.notification_digest_slot(jsonb_populate_record(null::public.notification_preferences,$1),'2026-10-28T11:00:00Z')::text due",
          [{ ...base, digest_hour: 23 }],
        );
        assert.equal(new Date(slot.due).toISOString(), '2026-10-28T03:00:00.000Z');
      },
    );
    await scenario(
      'daily mode routes pending updates into one daily batch, retries keep exact payload, lease token required',
      async () => {
        await prefs(db);
        await enqueue(db);
        await enqueue(db);
        await service(db);
        const immediate = (await db.query('select * from public.claim_notification_emails(20)'))
          .rows;
        assert.equal(
          immediate.filter((x) => x.recipient_email === 'events-requester@example.invalid').length,
          0,
        );
        await makeDue(db);
        const batch = await claim(db);
        assert.equal(batch.length, 1);
        assert.equal(batch[0].total, 2);
        assert.equal((await claim(db)).length, 0);
        assert.equal(
          (
            await one(db, 'select public.finish_notification_digest($1,$2,$3,false) ok', [
              batch[0].digest_id,
              randomUUID(),
              'provider',
            ])
          ).ok,
          false,
        );
        assert.equal(
          (
            await one(db, 'select public.finish_notification_digest($1,$2,null,true) ok', [
              batch[0].digest_id,
              batch[0].lease_token,
            ])
          ).ok,
          true,
        );
        await owner(db);
        await db.exec(
          "update private.notification_digests set available_at=now()-interval '1 minute'",
        );
        const retry = await claim(db);
        assert.equal(retry[0].digest_id, batch[0].digest_id);
        assert.deepEqual(retry[0].items, batch[0].items);
        await one(db, 'select public.finish_notification_digest($1,$2,$3,false)', [
          retry[0].digest_id,
          retry[0].lease_token,
          'provider-ok',
        ]);
        await owner(db);
        assert.equal(
          (
            await one(
              db,
              "select count(*)::int n from private.notification_email_outbox where digest_id=$1 and status='sent'",
              [batch[0].digest_id],
            )
          ).n,
          2,
        );
        await enqueue(db);
        assert.equal((await claim(db)).length, 0);
      },
    );
    await scenario(
      'off suppresses routine email while retaining in-app updates; quiet hours defer without dropping',
      async () => {
        await prefs(db, { email_mode: 'off' });
        await enqueue(db);
        await service(db);
        assert.equal(
          (await db.query('select * from public.claim_notification_emails(20)')).rows.filter(
            (x) => x.recipient_email === 'events-requester@example.invalid',
          ).length,
          0,
        );
        await identity(db, 'authenticated', ids.employee);
        assert.ok((await db.query('select * from public.notifications')).rows.length > 0);
        const local = await one(
          db,
          "select (now() at time zone 'UTC'-interval '1 hour')::time::text start,(now() at time zone 'UTC'+interval '1 hour')::time::text finish",
        );
        await prefs(
          db,
          {
            email_mode: 'immediate',
            quiet_enabled: true,
            quiet_start: local.start,
            quiet_end: local.finish,
          },
          ids.employee,
          ids.org,
          1,
        );
        const target = await enqueue(db);
        await service(db);
        assert.equal(
          (await db.query('select * from public.claim_notification_emails(20)')).rows.filter(
            (x) =>
              x.ticket_id === target.id && x.recipient_email === 'events-requester@example.invalid',
          ).length,
          0,
        );
        await owner(db);
        assert.equal(
          (
            await one(
              db,
              'select private.notification_email_mode(n) mode from public.notifications n where ticket_id=$1 and recipient_id=$2',
              [target.id, ids.employee],
            )
          ).mode,
          'quiet',
        );
        await prefs(
          db,
          { email_mode: 'immediate', quiet_enabled: false },
          ids.employee,
          ids.org,
          2,
        );
        await service(db);
        assert.equal(
          (await db.query('select * from public.claim_notification_emails(20)')).rows.filter(
            (x) =>
              x.ticket_id === target.id && x.recipient_email === 'events-requester@example.invalid',
          ).length,
          1,
        );
      },
    );
    await scenario(
      'updates arriving after an empty summary cutoff wait for the next summary rather than triggering a late email',
      async () => {
        await prefs(db);
        await makeDue(db);
        await enqueue(db);
        assert.equal((await claim(db)).length, 0);
        await makeDue(db);
        const batch = await claim(db);
        assert.equal(batch.length, 1);
      },
    );
    await scenario(
      'switching to daily does not rebundle an individual delivery with an uncertain provider outcome',
      async () => {
        const target = await enqueue(db);
        await service(db);
        const sent = (
          await db.query('select * from public.claim_notification_emails(20)')
        ).rows.find(
          (x) =>
            x.ticket_id === target.id && x.recipient_email === 'events-requester@example.invalid',
        );
        assert.ok(sent);
        await owner(db);
        await db.query(
          "update private.notification_email_outbox set status='pending',lease_until=null,lease_token=null,available_at=now()-interval '1 minute' where notification_id=$1",
          [sent.notification_id],
        );
        await prefs(db);
        await makeDue(db);
        assert.equal((await claim(db)).length, 0);
        await service(db);
        const retry = (
          await db.query('select * from public.claim_notification_emails(20)')
        ).rows.find((x) => x.notification_id === sent.notification_id);
        assert.ok(retry);
        assert.equal(retry.notification_id, sent.notification_id);
      },
    );
    await scenario(
      'urgent bypass follows the saved choice and Off still suppresses urgent email',
      async () => {
        await prefs(db, { urgent_immediate: true });
        const target = await enqueue(db);
        await owner(db);
        await db.query("update public.tickets set priority='critical' where id=$1", [target.id]);
        assert.equal(
          (
            await one(
              db,
              'select private.notification_email_mode(n) mode from public.notifications n where ticket_id=$1 and recipient_id=$2',
              [target.id, ids.employee],
            )
          ).mode,
          'immediate',
        );
        await prefs(db, { urgent_immediate: false }, ids.employee, ids.org, 1);
        await owner(db);
        assert.equal(
          (
            await one(
              db,
              'select private.notification_email_mode(n) mode from public.notifications n where ticket_id=$1 and recipient_id=$2',
              [target.id, ids.employee],
            )
          ).mode,
          'digest',
        );
        await prefs(db, { email_mode: 'off', urgent_immediate: true }, ids.employee, ids.org, 2);
        await owner(db);
        assert.equal(
          (
            await one(
              db,
              'select private.notification_email_mode(n) mode from public.notifications n where ticket_id=$1 and recipient_id=$2',
              [target.id, ids.employee],
            )
          ).mode,
          'off',
        );
      },
    );
    await scenario(
      'revoked membership cancels a captured retry; no stale guide or ticket title is resent',
      async () => {
        await prefs(db);
        await enqueue(db);
        await makeDue(db);
        const batch = await claim(db);
        await one(db, 'select public.finish_notification_digest($1,$2,null,true)', [
          batch[0].digest_id,
          batch[0].lease_token,
        ]);
        await owner(db);
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1",
          [ids.employee],
        );
        await db.exec(
          "update private.notification_digests set available_at=now()-interval '1 minute'",
        );
        assert.equal((await claim(db)).length, 0);
        await owner(db);
        assert.equal(
          (
            await one(db, 'select status from private.notification_digests where id=$1', [
              batch[0].digest_id,
            ])
          ).status,
          'skipped',
        );
      },
    );
  } finally {
    await db.close();
  }
});
