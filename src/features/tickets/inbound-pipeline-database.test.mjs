import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  employee = '10000000-0000-0000-0000-000000000404',
  worker = '10000000-0000-0000-0000-000000000403',
  colleague = '10000000-0000-0000-0000-000000000405';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function service(db) {
  await db.exec('reset role;set role service_role');
}
async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
test('thread receipts and attachment leases preserve privacy, deduplicate delivery and register files once in Postgres', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'colleague@example.invalid',now())",
      [colleague],
    );
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'end_user')",
      [org, colleague],
    );
    await db.query('update auth.users set email_confirmed_at=now() where id in ($1,$2)', [
      employee,
      worker,
    ]);
    const accept = async ({
      provider = 'original-provider',
      sender = 'events-requester@example.invalid',
      message = '<original@example.test>',
      refs = [],
      ids = [],
      count = ids.length,
    } = {}) => {
      await service(db);
      return (
        await one(
          db,
          'select public.accept_inbound_email($1,$2,$3,$4,$5,true,$6,$7,$8,$9) result',
          [
            provider,
            'events-a',
            sender,
            'Changed subject without a ticket number',
            'Please review the log.',
            count,
            message,
            refs,
            ids,
          ],
        )
      ).result;
    };
    const first = await accept({ ids: ['public-file'] });
    assert.equal(first.status, 'ticket_created');
    assert.equal((await accept({ ids: ['public-file'] })).duplicate, true);
    assert.equal((await accept({ provider: 'second-delivery' })).status, 'duplicate_message');
    const reply = await accept({
      provider: 'reply',
      message: '<reply@example.test>',
      refs: ['<original@example.test>'],
    });
    assert.equal(reply.status, 'reply_added');
    assert.equal(reply.ticket_id, first.ticket_id);
    const rejected = await accept({
      provider: 'forged',
      sender: 'colleague@example.invalid',
      message: '<forged@example.test>',
      refs: ['<original@example.test>'],
    });
    assert.equal(rejected.status, 'rejected_ticket');
    const note = await accept({
      provider: 'staff',
      sender: 'events-worker@example.invalid',
      message: '<staff@example.test>',
      refs: ['<reply@example.test>'],
      ids: ['private-file'],
    });
    assert.equal(note.status, 'note_added');
    assert.equal(note.ticket_id, first.ticket_id);
    const { jobs } = await one(db, 'select public.claim_inbound_attachments(2) jobs');
    assert.equal(jobs.length, 2);
    const attachmentIds = [];
    const paths = [];
    for (const job of jobs) {
      const key = job.attachment_ids[0];
      const args = [job.id, job.lease_token, key, true, 'log.txt', 'text/plain', 20];
      assert.equal(
        (await one(db, 'select public.record_inbound_attachment($1,$2,$3,$4,$5,$6,$7) ok', args))
          .ok,
        true,
      );
      assert.equal(
        (await one(db, 'select public.record_inbound_attachment($1,$2,$3,$4,$5,$6,$7) ok', args))
          .ok,
        true,
      );
      assert.equal(
        (
          await one(db, 'select public.finish_inbound_attachments($1,$2,true) ok', [
            job.id,
            job.lease_token,
          ])
        ).ok,
        true,
      );
    }
    await db.exec('reset role');
    const files = (
      await db.query(
        'select id,storage_path,is_internal from public.ticket_attachments where ticket_id=$1 order by is_internal',
        [first.ticket_id],
      )
    ).rows;
    assert.equal(files.length, 2);
    assert.deepEqual(
      files.map((f) => f.is_internal),
      [false, true],
    );
    for (const file of files) {
      attachmentIds.push(file.id);
      paths.push(file.storage_path);
      await db.query(
        "insert into storage.objects(bucket_id,name) values('ticket-attachments',$1)",
        [file.storage_path],
      );
    }
    const counts = (
      await db.query(
        "select imported_attachments from public.inbound_emails where provider_email_id in ('original-provider','staff')",
      )
    ).rows;
    assert.deepEqual(
      counts.map((r) => r.imported_attachments),
      [1, 1],
    );
    await identity(db, employee);
    assert.equal(
      (
        await db.query('select id from public.ticket_attachments where id=any($1::uuid[])', [
          attachmentIds,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query('select name from storage.objects where name=any($1::text[])', [paths])).rows
        .length,
      1,
    );
    await identity(db, worker);
    assert.equal(
      (
        await db.query('select id from public.ticket_attachments where id=any($1::uuid[])', [
          attachmentIds,
        ])
      ).rows.length,
      2,
    );
    assert.equal(
      (await db.query('select name from storage.objects where name=any($1::text[])', [paths])).rows
        .length,
      2,
    );
    await assert.rejects(db.query('select public.claim_inbound_attachments(1)'));
    await db.exec('reset role');
    await db.query("update public.tickets set status='closed' where id=$1", [first.ticket_id]);
    const closed = await accept({
      provider: 'closed-reply',
      message: '<closed-reply@example.test>',
      refs: ['<original@example.test>'],
    });
    assert.equal(closed.ticket_id, first.ticket_id);
    assert.equal(closed.status, 'reply_added');
  } finally {
    await db.close();
  }
});
