import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401';
const employee = '10000000-0000-0000-0000-000000000404';
const worker = '10000000-0000-0000-0000-000000000403';
const outsider = '10000000-0000-0000-0000-000000000402';
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
async function age(db, id, extra = '') {
  await db.exec('alter table public.chat_conversations disable trigger chat_prepare_change');
  try {
    await db.query(
      `update public.chat_conversations set updated_at=now()-interval '4 days' ${extra} where id=$1`,
      [id],
    );
  } finally {
    await db.exec('alter table public.chat_conversations enable trigger chat_prepare_change');
  }
}
async function chat(db, { reply = true, kind = 'message' } = {}) {
  const { id } = await one(
    db,
    "insert into public.chat_conversations(organization_id,requester_id,topic) values($1,$2,'Printer is offline') returning id",
    [org, employee],
  );
  await db.query(
    "insert into public.chat_messages(organization_id,conversation_id,author_id,body,created_at) values($1,$2,$3,'Please help',now()-interval '5 days')",
    [org, id, employee],
  );
  if (reply)
    await db.query(
      "insert into public.chat_messages(organization_id,conversation_id,author_id,kind,body,created_at) values($1,$2,$3,$4,'Restart the printer',now()-interval '4 days')",
      [org, id, worker, kind],
    );
  await age(db, id);
  return id;
}
async function role(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, sql, args = []) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(db.query(sql, args));
  } finally {
    await db.exec('rollback to denied; release savepoint denied');
  }
}
test('chat idle lifecycle preserves unanswered work, warns once, closes safely and protects private context', async (t) => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await db.exec(await fs.readFile('tests/fixtures/domain-events.sql', 'utf8'));
    const answered = await chat(db);
    const unanswered = await chat(db, { reply: false });
    const noteOnly = await chat(db, { kind: 'internal_note' });
    let result = await one(db, 'select public.process_idle_chats() result');
    assert.equal(result.result.warned, 1);
    assert.equal(result.result.closed, 0, 'old chats receive a fresh warning before closure');
    assert.equal(
      (await one(db, "select count(*) n from public.notifications where kind='chat_idle_warning'"))
        .n,
      1,
    );
    assert.equal(
      (
        await one(
          db,
          "select count(*) n from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.kind='chat_idle_warning'",
        )
      ).n,
      1,
    );
    await age(db, answered);
    await db.exec('select public.process_idle_chats()');
    assert.equal(
      (await one(db, "select count(*) n from public.notifications where kind='chat_idle_warning'"))
        .n,
      1,
    );
    await t.test('members cannot run the worker or forge lifecycle state', async () => {
      for (const id of [employee, worker, outsider]) {
        await role(db, id);
        await denied(db, 'select public.process_idle_chats()');
        await denied(
          db,
          "update public.chat_conversations set closure_summary='forged' where id=$1",
          [answered],
        );
      }
      await role(db, employee);
      await denied(
        db,
        "insert into public.chat_conversations(organization_id,requester_id,topic,idle_closed_at) values($1,$2,'Forged closure',now())",
        [org, employee],
      );
      await db.exec('reset role');
    });
    await t.test('employee replies cancel pending warnings and prevent closure', async () => {
      await db.query(
        "insert into public.chat_messages(organization_id,conversation_id,author_id,body) values($1,$2,$3,'I still need help')",
        [org, answered, employee],
      );
      assert.equal(
        (
          await one(db, 'select idle_warning_at from public.chat_conversations where id=$1', [
            answered,
          ])
        ).idle_warning_at,
        null,
      );
      assert.equal(
        (
          await one(
            db,
            "select q.status from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.kind='chat_idle_warning' and n.conversation_id=$1",
            [answered],
          )
        ).status,
        'skipped',
      );
      await age(db, answered);
      await db.exec('select public.process_idle_chats()');
      assert.equal(
        (await one(db, 'select status from public.chat_conversations where id=$1', [answered]))
          .status,
        'open',
      );
    });
    await t.test('uploads reset warnings and recent IT replies do not qualify', async () => {
      const fileChat = await chat(db);
      await db.exec('select public.process_idle_chats()');
      await db.query(
        "insert into public.chat_attachments(organization_id,conversation_id,uploaded_by,storage_path,file_name,content_type,size_bytes) values($1,$2,$3,$4,'screen.png','image/png',1024)",
        [org, fileChat, employee, `${org}/${fileChat}/${employee}/screen.png`],
      );
      assert.equal(
        (
          await one(db, 'select idle_warning_at from public.chat_conversations where id=$1', [
            fileChat,
          ])
        ).idle_warning_at,
        null,
      );
      await age(db, fileChat);
      await db.exec('select public.process_idle_chats()');
      assert.equal(
        (await one(db, 'select status from public.chat_conversations where id=$1', [fileChat]))
          .status,
        'open',
      );
      const fresh = await chat(db, { reply: false });
      await db.query(
        "insert into public.chat_messages(organization_id,conversation_id,author_id,body) values($1,$2,$3,'Here is the next step')",
        [org, fresh, worker],
      );
      await age(db, fresh);
      await db.exec('select public.process_idle_chats()');
      assert.equal(
        (
          await one(db, 'select idle_warning_at from public.chat_conversations where id=$1', [
            fresh,
          ])
        ).idle_warning_at,
        null,
      );
    });
    const closing = await chat(db);
    await db.exec('select public.process_idle_chats()');
    await age(
      db,
      closing,
      ",idle_warning_at=now()-interval '1 day',idle_warning_due_at=now()-interval '1 hour'",
    );
    await db.exec('select public.process_idle_chats()');
    const closed = await one(db, 'select * from public.chat_conversations where id=$1', [closing]);
    assert.equal(closed.status, 'closed');
    assert.ok(closed.idle_closed_at);
    assert.match(closed.closure_summary, /Printer is offline/);
    assert.match(closed.closure_summary, /Restart the printer/);
    assert.doesNotMatch(closed.closure_summary, /internal_note/);
    assert.equal(
      (
        await one(
          db,
          "select count(*) n from public.notifications where kind='chat_auto_closed' and conversation_id=$1",
          [closing],
        )
      ).n,
      1,
    );
    assert.equal(
      (
        await one(
          db,
          "select count(*) n from public.audit_events where entity_type='chat_conversations' and entity_id=$1 and changes::text like '%closed%'",
          [closing],
        )
      ).n,
      1,
    );
    await db.exec('select public.process_idle_chats()');
    assert.equal(
      (
        await one(
          db,
          "select count(*) n from public.notifications where kind='chat_auto_closed' and conversation_id=$1",
          [closing],
        )
      ).n,
      1,
    );
    for (const id of [unanswered, noteOnly])
      assert.equal(
        (await one(db, 'select status from public.chat_conversations where id=$1', [id])).status,
        'open',
      );
    await role(db, employee);
    assert.match(
      (
        await one(db, 'select closure_summary from public.chat_conversations where id=$1', [
          closing,
        ])
      ).closure_summary,
      /Restart the printer/,
    );
    await denied(
      db,
      "insert into public.chat_messages(organization_id,conversation_id,author_id,body) values($1,$2,$3,'Too late')",
      [org, closing, employee],
    );
    await role(db, outsider);
    assert.equal(
      (
        await db.query('select closure_summary from public.chat_conversations where id=$1', [
          closing,
        ])
      ).rows.length,
      0,
    );
    await db.exec('reset role');
    await t.test('bounded scans rotate past unanswered chats', async () => {
      const eligible = await chat(db);
      for (let scan = 0; scan < 20; scan++) await db.exec('select public.process_idle_chats(1)');
      assert.ok(
        (
          await one(db, 'select idle_warning_at from public.chat_conversations where id=$1', [
            eligible,
          ])
        ).idle_warning_at,
      );
    });
    await db.exec('reset role; rollback');
  } finally {
    await db.close();
  }
});
