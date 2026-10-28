import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('requesters rate each resolution once, staff read ratings and the satisfaction summary', async () => {
  const db = await migratedPostgres();
  const org = randomUUID(),
    otherOrg = randomUUID(),
    employee = randomUUID(),
    colleague = randomUUID(),
    worker = randomUUID(),
    outsider = randomUUID();
  const as = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.exec('set role authenticated');
  };
  const ticket = async (status, extra = '') => {
    await db.exec('reset role');
    const id = randomUUID();
    await db.query(
      `insert into public.tickets(id,organization_id,requester_id,assigned_technician_id,status,title,description,priority) values($1,$2,$3,$4,$5,'Laptop','Will not boot','normal')`,
      [id, org, employee, worker, status],
    );
    if (extra) {
      await db.exec('set session_replication_role = replica');
      await db.query(extra, [id]);
      await db.exec('set session_replication_role = default');
    }
    return id;
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Ratings','ratings'),($2,'Elsewhere','ratings-elsewhere')",
      [org, otherOrg],
    );
    for (const [id, target, role] of [
      [employee, org, 'end_user'],
      [colleague, org, 'end_user'],
      [worker, org, 'technician'],
      [outsider, otherOrg, 'technician'],
    ]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
        id,
        `${id}@example.test`,
      ]);
      await db.query(
        'insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',
        [target, id, role],
      );
      await db.query(
        "insert into public.profiles(organization_id,user_id,display_name) values($1,$2,'Person')",
        [target, id],
      );
    }

    const open = await ticket('open');
    await as(employee);
    await assert.rejects(db.query('select public.rate_ticket_resolution($1,5,null)', [open]), {
      code: 'PT409',
    });

    const resolved = await ticket('resolved');
    await as(colleague);
    await assert.rejects(db.query('select public.rate_ticket_resolution($1,5,null)', [resolved]), {
      code: '42501',
    });
    await as(employee);
    for (const score of [0, 6]) {
      await assert.rejects(
        db.query('select public.rate_ticket_resolution($1,$2,null)', [resolved, score]),
        { code: '22023' },
      );
    }
    await assert.rejects(
      db.query('select public.rate_ticket_resolution($1,4,$2)', [resolved, 'x'.repeat(1001)]),
      { code: '22023' },
    );
    // Direct writes are never allowed, even for the requester.
    await assert.rejects(
      db.query(
        'insert into public.ticket_resolution_ratings(organization_id,ticket_id,requester_id,resolved_at,score) values($1,$2,$3,now(),5)',
        [org, resolved, employee],
      ),
      { code: '42501' },
    );

    await db.query('select public.rate_ticket_resolution($1,2,$2)', [resolved, '  Slow fix  ']);
    // A retried identical submission adds no history; a change records the previous score.
    await db.query('select public.rate_ticket_resolution($1,2,$2)', [resolved, 'Slow fix']);
    await db.query('select public.rate_ticket_resolution($1,4,$2)', [resolved, 'Fixed well']);
    const mine = await db.query(
      'select score,comment,assigned_technician_id from public.ticket_resolution_ratings where ticket_id=$1',
      [resolved],
    );
    assert.deepEqual(mine.rows, [
      { score: 4, comment: 'Fixed well', assigned_technician_id: worker },
    ]);
    await db.exec('reset role');
    const history = await db.query(
      "select details from public.ticket_activity where ticket_id=$1 and action='resolution_rated' order by id",
      [resolved],
    );
    assert.deepEqual(
      history.rows.map((row) => row.details),
      [{ score: 2 }, { score: 4, previous: 2 }],
    );

    // Closing keeps the same resolution cycle; reopening and resolving starts a new one.
    await as(worker);
    await db.query("update public.tickets set status='closed' where id=$1", [resolved]);
    await as(employee);
    await db.query('select public.rate_ticket_resolution($1,5,null)', [resolved]);
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from public.ticket_resolution_ratings where ticket_id=$1',
          [resolved],
        )
      ).rows[0].n,
      1,
    );
    await as(worker);
    await db.query("update public.tickets set status='open' where id=$1", [resolved]);
    await db.query("update public.tickets set status='resolved' where id=$1", [resolved]);
    await as(employee);
    await db.query('select public.rate_ticket_resolution($1,1,$2)', [resolved, 'Broke again']);
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from public.ticket_resolution_ratings where ticket_id=$1',
          [resolved],
        )
      ).rows[0].n,
      2,
    );

    const stale = await ticket(
      'resolved',
      "update public.tickets set resolved_at=now()-interval '31 days' where id=$1",
    );
    await as(employee);
    await assert.rejects(db.query('select public.rate_ticket_resolution($1,5,null)', [stale]), {
      code: 'PT410',
    });

    // Visibility: requester sees own, colleague sees none, staff see all, other tenants none.
    await as(colleague);
    assert.equal(
      (await db.query('select count(*)::int n from public.ticket_resolution_ratings')).rows[0].n,
      0,
    );
    await assert.rejects(db.query('select public.satisfaction_summary($1,30)', [org]), {
      code: '42501',
    });
    await as(outsider);
    assert.equal(
      (await db.query('select count(*)::int n from public.ticket_resolution_ratings')).rows[0].n,
      0,
    );
    await assert.rejects(db.query('select public.satisfaction_summary($1,30)', [org]), {
      code: '42501',
    });
    await as(worker);
    const summary = (await db.query('select public.satisfaction_summary($1,30) s', [org])).rows[0]
      .s;
    assert.equal(summary.responses, 2);
    assert.equal(summary.satisfied, 1);
    assert.equal(Number(summary.average), 3);
    assert.deepEqual(
      summary.distribution.map((row) => [row.score, row.count]),
      [
        [5, 1],
        [4, 0],
        [3, 0],
        [2, 0],
        [1, 1],
      ],
    );
    assert.deepEqual(
      summary.comments.map((row) => row.comment),
      ['Broke again'],
    );
  } finally {
    await db.close();
  }
});
