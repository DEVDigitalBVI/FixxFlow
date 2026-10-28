import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { action } from '../../../tests/fixtures/automation.mjs';
import {
  activate,
  createRule,
  identity,
  ids,
  owner,
  runAutomationWorker,
  seed,
  service,
  storeFor,
  ticket,
} from '../../../tests/helpers/automation-worker.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
async function work(db) {
  await service(db);
  await runAutomationWorker(storeFor(db), { enabled: true, log() {} });
  await owner(db);
}
async function denied(db, sql, args = []) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(db.query(sql, args));
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
test('intake triggers and article reply run through real durable worker authority', async (t) => {
  const db = await migratedPostgres();
  try {
    async function scenario(name, fn) {
      await t.test(name, async () => {
        await db.exec('begin');
        try {
          await seed(db);
          await fn();
        } finally {
          await db.exec('rollback');
        }
      });
    }
    await scenario(
      'registry catalog parity includes the reviewed intake and reply contracts',
      async () => {
        const { persistenceCatalog } = load('src/features/automation/persistence-contract.ts');
        assert.deepEqual(
          (await one(db, 'select private.automation_definition_catalog() c')).c,
          persistenceCatalog,
        );
      },
    );
    await scenario(
      'one visible relevant reply across multiple rules, no private content, SLA unaffected, employee notified',
      async () => {
        await activate(db);
        await createRule(db, { actions: [action('suggest_articles', {})] });
        await createRule(db, { actions: [action('suggest_articles', {})] });
        await owner(db);
        const guide = randomUUID();
        await db.query(
          `insert into public.knowledge_articles(id,organization_id,title,summary,category,status,audience,content) values($1,$2,'Worker test recovery','Useful worker recovery','Software','published','employees','[{"type":"paragraph","text":"Steps"}]')`,
          [guide, ids.org],
        );
        for (const [tenant, audience, status] of [
          [ids.org, 'it_only', 'published'],
          [ids.org, 'employees', 'draft'],
          [ids.otherOrg, 'employees', 'published'],
        ])
          await db.query(
            'insert into public.knowledge_articles(organization_id,author_id,title,summary,category,status,audience,content) values($1,null,\'Worker test secret\',\'SECRET\',\'Software\',$3,$2,\'[{"type":"paragraph","text":"Steps"}]\')',
            [tenant, audience, status],
          );
        const platform = randomUUID(),
          session = randomUUID();
        await db.query('insert into auth.users(id,email) values($1,$2)', [
          platform,
          platform + '@example.invalid',
        ]);
        await db.query('insert into private.platform_owners(user_id) values($1)', [platform]);
        await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, platform]);
        await db.query(
          "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
          [randomUUID(), platform],
        );
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({
            sub: platform,
            role: 'authenticated',
            aal: 'aal2',
            session_id: session,
          }),
        ]);
        for (const [audience, hidden] of [
          ['it_only', false],
          ['employees', true],
        ]) {
          const id = randomUUID();
          await db.query(
            'insert into public.library_articles(id,title,category,status,audience,content) values($1,\'Worker test hidden\',\'Software\',\'published\',$2,\'[{"type":"paragraph","text":"Steps"}]\')',
            [id, audience],
          );
          if (hidden)
            await db.query(
              'insert into public.hidden_library_articles(organization_id,article_id,created_by) values($1,$2,$3)',
              [ids.org, id, ids.admin],
            );
        }
        const a = await ticket(db);
        await work(db);
        const messages = (
          await db.query('select * from public.ticket_messages where ticket_id=$1', [a.id])
        ).rows;
        assert.equal(messages.length, 1);
        assert.equal(messages[0].kind, 'reply');
        assert.equal(messages[0].author_id, null);
        assert.ok(messages[0].body.includes(guide));
        assert.ok(!messages[0].body.includes('secret'));
        assert.ok(!messages[0].body.includes('hidden'));
        assert.equal(messages[0].automation_name, 'Article suggestions');
        assert.equal(
          (await one(db, 'select first_response_at from public.tickets where id=$1', [a.id]))
            .first_response_at,
          null,
        );
        assert.ok(
          (
            await one(
              db,
              'select count(*)::integer n from public.notifications where ticket_id=$1 and recipient_id=$2',
              [a.id, ids.employee],
            )
          ).n > 0,
        );
        const activity = (
          await db.query(
            "select details from public.ticket_activity where ticket_id=$1 and action='reply_added'",
            [a.id],
          )
        ).rows;
        assert.equal(activity[0].details.automationName, 'Article suggestions');
        await identity(db, 'authenticated', ids.employee);
        assert.equal(
          (await db.query('select body from public.ticket_messages where ticket_id=$1', [a.id]))
            .rows.length,
          1,
        );
        await denied(db, 'select private.reply_with_suggested_articles()');
        await owner(db);
        await work(db);
        assert.equal(
          (
            await one(
              db,
              'select count(*)::integer n from public.ticket_messages where ticket_id=$1',
              [a.id],
            )
          ).n,
          1,
        );
      },
    );
    await scenario('resolved tickets never receive an automatic guide reply', async () => {
      await activate(db);
      await createRule(db, {
        actions: [action('set_status', { status: 'resolved' }), action('suggest_articles', {}, 1)],
      });
      await owner(db);
      await db.query(
        `insert into public.knowledge_articles(organization_id,title,category,status,audience,content) values($1,'Worker test solution','Software','published','employees','[{"type":"paragraph","text":"Steps"}]')`,
        [ids.org],
      );
      const a = await ticket(db);
      await work(db);
      assert.equal(
        (
          await one(db, 'select count(*)::int n from public.ticket_messages where ticket_id=$1', [
            a.id,
          ])
        ).n,
        0,
      );
      assert.equal(
        (await one(db, 'select status from public.tickets where id=$1', [a.id])).status,
        'resolved',
      );
    });
    await scenario(
      'a human reply takes precedence over the delayed creation automation',
      async () => {
        await activate(db);
        await createRule(db, { actions: [action('suggest_articles', {})] });
        await owner(db);
        await db.query(
          `insert into public.knowledge_articles(organization_id,title,category,status,audience,content) values($1,'Worker test solution','Software','published','employees','[{"type":"paragraph","text":"Steps"}]')`,
          [ids.org],
        );
        const a = await ticket(db);
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','A human is helping')",
          [ids.org, a.id, ids.admin],
        );
        await work(db);
        assert.equal(
          (
            await one(
              db,
              "select count(*)::int n from public.ticket_messages where ticket_id=$1 and author_type='automation'",
              [a.id],
            )
          ).n,
          0,
        );
        assert.ok(
          (await one(db, 'select first_response_at from public.tickets where id=$1', [a.id]))
            .first_response_at,
        );
      },
    );
    await scenario('no relevant guide produces no reply and no new notification', async () => {
      await activate(db);
      await createRule(db, { actions: [action('suggest_articles', {})] });
      const a = await ticket(db);
      await owner(db);
      const before = (await one(db, 'select count(*)::integer n from public.notifications')).n;
      await work(db);
      assert.equal(
        (
          await one(
            db,
            'select count(*)::integer n from public.ticket_messages where ticket_id=$1',
            [a.id],
          )
        ).n,
        0,
      );
      assert.equal(
        (await one(db, 'select count(*)::integer n from public.notifications')).n,
        before,
      );
      const step = await one(
        db,
        "select * from public.automation_execution_steps where action_type='suggest_articles'",
      );
      assert.equal(step.status, 'succeeded', JSON.stringify(step));
      assert.equal(step.result.code, 'no_article_reply');
    });
    await scenario(
      'chat conversion emits once; employees and other tenants denied; linking is not conversion',
      async () => {
        await activate(db);
        await createRule(db, {
          trigger: 'ticket.created_from_chat',
          actions: [action('add_internal_note', { body: 'Converted chat received' })],
        });
        await identity(db, 'authenticated', ids.employee);
        const c = await one(
          db,
          "insert into public.chat_conversations(organization_id,requester_id,topic) values($1,$2,'Worker test chat') returning *",
          [ids.org, ids.employee],
        );
        await denied(db, 'select public.convert_chat_to_ticket($1)', [c.id]);
        await identity(db, 'authenticated', ids.otherAdmin);
        await denied(db, 'select public.convert_chat_to_ticket($1)', [c.id]);
        await identity(db, 'authenticated', ids.worker);
        const target = (await one(db, 'select public.convert_chat_to_ticket($1) id', [c.id])).id;
        assert.equal(
          (await one(db, 'select public.convert_chat_to_ticket($1) id', [c.id])).id,
          target,
        );
        await work(db);
        assert.equal(
          (
            await one(
              db,
              "select count(*)::integer n from private.domain_events where entity_id=$1 and event_type='ticket.created_from_chat'",
              [target],
            )
          ).n,
          1,
        );
        assert.equal(
          (await one(db, 'select body from public.ticket_messages where ticket_id=$1', [target]))
            .body,
          'Converted chat received',
        );
      },
    );
    await scenario(
      'validated email creation emits one source event; retries and rejected senders do not',
      async () => {
        await activate(db);
        await createRule(db, {
          trigger: 'ticket.created_from_email',
          actions: [action('add_internal_note', { body: 'Email received' })],
        });
        await owner(db);
        await db.query('update auth.users set email_confirmed_at=now() where id=$1', [
          ids.employee,
        ]);
        await service(db);
        const params = [
          'email-intake-test',
          'events-a',
          'events-requester@example.invalid',
          'Worker test email',
          'Intake body',
          true,
          0,
        ];
        const result = (
          await one(db, 'select public.accept_inbound_email($1,$2,$3,$4,$5,$6,$7) r', params)
        ).r;
        await one(db, 'select public.accept_inbound_email($1,$2,$3,$4,$5,$6,$7) r', params);
        await one(db, 'select public.accept_inbound_email($1,$2,$3,$4,$5,false,$6) r', [
          'forged-test',
          ...params.slice(1, 5),
          0,
        ]);
        await work(db);
        assert.equal(
          (
            await one(
              db,
              "select count(*)::integer n from private.domain_events where event_type='ticket.created_from_email'",
            )
          ).n,
          1,
        );
        assert.equal(
          (
            await one(
              db,
              "select count(*)::integer n from public.ticket_messages where body='Email received'",
            )
          ).n,
          1,
        );
        assert.ok(result);
      },
    );
  } finally {
    await db.close();
  }
});
