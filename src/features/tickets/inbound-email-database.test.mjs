import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('inbound email accepts only authenticated members and never touches another person’s ticket', async () => {
  const db = await migratedPostgres();
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const u = {
    employee: randomUUID(),
    colleague: randomUUID(),
    tech: randomUUID(),
    admin: randomUUID(),
    foreign: randomUUID(),
  };
  const email = (user) => `${user.slice(0, 8)}@example.test`;
  const accept = async (fields) => {
    await db.exec('reset role');
    await db.exec('set role service_role');
    const row = (
      await db.query('select public.accept_inbound_email($1,$2,$3,$4,$5,$6,$7) as result', [
        fields.id ?? randomUUID(),
        fields.slug ?? 'alpha-desk',
        fields.from,
        fields.subject ?? 'Printer broken',
        fields.body ?? 'It jams on page two.',
        fields.authenticated ?? true,
        fields.attachments ?? 0,
      ])
    ).rows[0].result;
    await db.exec('reset role');
    return row;
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Alpha','alpha-desk'),($2,'Bravo','bravo-desk')",
      [orgA, orgB],
    );
    for (const [user, org, role] of [
      [u.employee, orgA, 'end_user'],
      [u.colleague, orgA, 'end_user'],
      [u.tech, orgA, 'technician'],
      [u.admin, orgA, 'administrator'],
      [u.foreign, orgB, 'end_user'],
    ]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
        user,
        email(user),
      ]);
      await db.query(
        'insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',
        [org, user, role],
      );
    }
    // A ticket in the other workspace with the number this workspace will reuse.
    await db.query(
      "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'Bravo secret','Private')",
      [orgB, u.foreign],
    );

    assert.equal(
      (await accept({ slug: 'nobody', from: email(u.employee) })).status,
      'rejected_recipient',
    );
    assert.equal(
      (await accept({ from: email(u.employee), authenticated: false })).status,
      'rejected_unauthenticated',
      'failed DMARC never creates tickets, even from a member address',
    );
    assert.equal(
      (await accept({ from: email(u.foreign) })).status,
      'rejected_sender',
      'members of another workspace cannot email this one',
    );

    const messageId = randomUUID();
    const created = await accept({
      id: messageId,
      from: `  ${email(u.employee).toUpperCase()} `,
      subject: 'Re: Fwd: Printer broken',
      attachments: 2,
    });
    assert.equal(created.status, 'ticket_created');
    const ticket = (
      await db.query(
        'select id, ticket_number, title, description, requester_id from public.tickets where id=$1',
        [created.ticket_id],
      )
    ).rows[0];
    assert.equal(ticket.title, 'Printer broken');
    assert.equal(ticket.requester_id, u.employee);
    assert.match(ticket.description, /^It jams on page two\.\n\n\[This email had 2 attachments/);
    assert.deepEqual(
      await accept({ id: messageId, from: email(u.employee) }),
      { status: 'ticket_created', ticket_id: created.ticket_id, duplicate: true },
      'a repeated webhook delivery is idempotent',
    );

    const subject = `Re: Printer broken [#${ticket.ticket_number}]`;
    assert.equal(
      (await accept({ from: email(u.employee), subject, body: 'Still jamming' })).status,
      'reply_added',
    );
    assert.equal(
      (await accept({ from: email(u.colleague), subject, body: 'Me too' })).status,
      'rejected_ticket',
      'another employee cannot reply to someone else’s ticket',
    );
    assert.equal(
      (await accept({ from: email(u.tech), subject, body: 'Ordering toner' })).status,
      'note_added',
    );
    const messages = (
      await db.query(
        'select kind, body, author_id from public.ticket_messages where ticket_id=$1 order by created_at',
        [ticket.id],
      )
    ).rows;
    assert.deepEqual(
      messages.map((m) => [m.kind, m.body]),
      [
        ['reply', 'Still jamming'],
        ['internal_note', 'Ordering toner'],
      ],
      'requester email is public; staff email is an internal note; the rejected reply is absent',
    );

    // The automation-note guard still blocks server code posting as a member directly.
    await db.exec('set role service_role');
    await assert.rejects(
      db.query(
        "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','Forged')",
        [orgA, ticket.id, u.employee],
      ),
      /Validated automation note required/,
    );
    await assert.rejects(
      db.query(
        'insert into private.inbound_message_contexts(organization_id,ticket_id,author_id) values($1,$2,$3)',
        [orgA, ticket.id, u.employee],
      ),
      /permission denied/,
      'only the inbound function can authorize a member-authored message',
    );
    await db.exec('reset role');
    await db.query("update public.tickets set status='closed' where id=$1", [ticket.id]);
    const followUp = await accept({ from: email(u.employee), subject, body: 'It is back' });
    assert.equal(followUp.status, 'ticket_created');
    assert.equal(
      (await db.query('select title from public.tickets where id=$1', [followUp.ticket_id])).rows[0]
        .title,
      `Follow-up to #${ticket.ticket_number}: Printer broken`,
    );

    const bravo = (
      await db.query('select ticket_number from public.tickets where organization_id=$1', [orgB])
    ).rows[0].ticket_number;
    const crossTenant = await accept({ from: email(u.employee), subject: `Help [#${bravo}]` });
    assert.notEqual(
      (
        await db.query('select organization_id from public.tickets where id=$1', [
          crossTenant.ticket_id,
        ])
      ).rows[0].organization_id,
      orgB,
      'a ticket number from another workspace never reaches that workspace',
    );

    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: u.admin, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.exec('set role authenticated');
    await assert.rejects(
      db.query("select public.accept_inbound_email('x','alpha-desk','a@b.c','s','b',true,0)"),
      /permission denied/,
      'signed-in users cannot call the webhook function',
    );
    const log = (await db.query('select status from public.inbound_emails order by created_at, id'))
      .rows;
    assert.ok(
      log.some((row) => row.status === 'rejected_sender'),
      'administrators see rejections',
    );
    assert.ok(log.every((row) => row.status !== 'rejected_recipient'));
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: u.employee, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.exec('set role authenticated');
    assert.equal(
      (await db.query('select id from public.inbound_emails')).rows.length,
      0,
      'only administrators can read the inbound log',
    );
  } finally {
    await db.close();
  }
});
