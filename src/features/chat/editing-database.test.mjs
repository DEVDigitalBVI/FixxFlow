import assert from 'node:assert/strict';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000901',
  worker = '10000000-0000-0000-0000-000000000901',
  employee = '10000000-0000-0000-0000-000000000902',
  chat = '40000000-0000-0000-0000-000000000901',
  message = '50000000-0000-0000-0000-000000000901';
const identity = async (db, id) => {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, aal: 'aal1' }),
  ]);
};
const edit = (db, body, revision = 1, conversation = chat, organization = org) =>
  db.query('select * from public.edit_chat_message($1,$2,$3,$4,$5)', [
    organization,
    conversation,
    message,
    revision,
    body,
  ]);

test('only message authors can edit open chats, with server-owned metadata and stale-write protection', async () => {
  const db = await migratedPostgres();
  try {
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at)values($1,$3,now()),($2,$4,now())',
      [worker, employee, 'edit-worker@example.invalid', 'edit-employee@example.invalid'],
    );
    await db.query(
      "insert into public.organizations(id,name,slug)values($1,'Edit test','edit-test')",
      [org],
    );
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role)values($1,$2,'administrator'),($1,$3,'end_user')",
      [org, worker, employee],
    );
    await db.query(
      "insert into public.chat_conversations(id,organization_id,requester_id,topic)values($1,$2,$3,'Edit messages')",
      [chat, org, employee],
    );
    await identity(db, employee);
    const original = (
      await db.query(
        'insert into public.chat_messages(id,organization_id,conversation_id,author_id,body)values($1,$2,$3,$4,$5)returning *',
        [message, org, chat, employee, 'A typo'],
      )
    ).rows[0];
    const updated = (await edit(db, '  A correction  ')).rows[0];
    assert.equal(updated.body, 'A correction');
    assert.equal(updated.revision, 2);
    assert.ok(updated.edited_at);
    assert.deepEqual(updated.created_at, original.created_at);
    assert.equal((await edit(db, 'Overwrite newer text', 1)).rows.length, 0);
    assert.equal(
      (await edit(db, 'A correction', 2)).rows[0].revision,
      2,
      'No-op saves do not invent edits',
    );
    assert.equal(
      (await edit(db, 'Wrong scope', 2, '40000000-0000-0000-0000-000000000999')).rows.length,
      0,
    );
    assert.equal(
      (await edit(db, 'Wrong org', 2, chat, '20000000-0000-0000-0000-000000000999')).rows.length,
      0,
    );
    await assert.rejects(edit(db, '   ', 2), /up to 20,000/);
    await assert.rejects(edit(db, 'a'.repeat(20001), 2), /up to 20,000/);
    await assert.rejects(
      db.query("update public.chat_messages set kind='internal_note' where id=$1", [message]),
      /permission denied/,
    );
    await assert.rejects(
      db.query('update public.chat_messages set revision=99 where id=$1', [message]),
      /permission denied/,
    );
    await identity(db, worker);
    assert.equal((await edit(db, 'A technician cannot rewrite an employee', 2)).rows.length, 0);
    const note = '50000000-0000-0000-0000-000000000902';
    await db.query(
      "insert into public.chat_messages(id,organization_id,conversation_id,author_id,kind,body)values($1,$2,$3,$4,'internal_note','Private typo')",
      [note, org, chat, worker],
    );
    assert.equal(
      (
        await db.query('select * from public.edit_chat_message($1,$2,$3,1,$4)', [
          org,
          chat,
          note,
          'Private correction',
        ])
      ).rows[0].revision,
      2,
    );
    await identity(db, employee);
    assert.equal(
      (await db.query('select * from public.chat_messages where id=$1', [note])).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query('select * from public.edit_chat_message($1,$2,$3,2,$4)', [
          org,
          chat,
          note,
          'Cannot expose a note',
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('anon','public.edit_chat_message(uuid,uuid,uuid,integer,text)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from public.notifications where conversation_id=$1',
          [chat],
        )
      ).rows[0].n,
      1,
      'Edits do not create duplicate message notifications',
    );
    await db.query("update public.chat_conversations set status='closed' where id=$1", [chat]);
    await identity(db, employee);
    assert.equal((await edit(db, 'Cannot edit a closed conversation', 2)).rows.length, 0);
  } finally {
    await db.close();
  }
});
