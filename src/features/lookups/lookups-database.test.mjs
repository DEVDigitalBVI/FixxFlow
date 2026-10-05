import assert from 'node:assert/strict';
import test from 'node:test';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { seed, ids, identity, owner } from '../../../tests/helpers/automation-worker.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

// Real migrated PostgreSQL queries; Auth claims are synthetic, not live sessions.
test('lookup pages cross the API row cap, preserve selections, and enforce tenant/role/MFA boundaries', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin'); await seed(db);
    await db.query(`insert into auth.users(id,email) select ('70000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'person' || n || '@example.invalid' from generate_series(1,1205) n`);
    await db.query(`insert into public.organization_memberships(organization_id,user_id,role) select $1,id,'end_user' from auth.users where id::text like '70000000%'`, [ids.org]);
    await db.query(`insert into public.profiles(organization_id,user_id,display_name,email) select $1,id,'Person ' || lpad(((row_number() over(order by id)-1)/2)::text,4,'0'),null from auth.users where id::text like '70000000%'`, [ids.org]);
    const rpc = async args => {
      const { rows } = await db.query('select * from public.lookup_choices($1,$2,$3,$4,$5,$6,$7,$8)', [args.org,args.resource,args.query??'',args.after_label??null,args.after_id??null,args.selected??null,args.parent??null,args.active_only??true]);
      return { data: rows, error: null };
    };
    const viewer = { organizationId: ids.org, role: 'administrator' };
    const { lookupChoices } = load('src/features/lookups/service.ts', {
      '@/lib/auth/viewer': { requireViewer: async () => viewer },
      '@/lib/supabase/server': { createClient: async () => ({ rpc: (name,args) => { assert.equal(name,'lookup_choices'); return rpc(args); } }) },
    });
    await identity(db);
    const selected = '70000000-0000-4000-8000-000000001205';
    const seen = []; let cursor = '';
    do {
      const result = await lookupChoices(new URLSearchParams({ resource:'people', q:'person', cursor, selected }));
      assert.ok(result.rows.length <= 50);
      assert.equal(result.selected.id,selected);
      seen.push(...result.rows.map(row=>row.id)); cursor=result.next;
    } while (cursor);
    assert.equal(seen.length,1205); assert.equal(new Set(seen).size,1205);
    const workers = await rpc({org:ids.org,resource:'technicians'});
    assert.ok(workers.data.every(row=>row.id===ids.admin));
    await owner(db);
    const category = (await db.query("insert into public.ticket_categories(organization_id,name,is_active) values($1,'Printer 100%_ *special*',false) returning id",[ids.org])).rows[0].id;
    const child = (await db.query("insert into public.ticket_subcategories(organization_id,category_id,name) values($1,$2,'A child') returning id",[ids.org,category])).rows[0].id;
    await identity(db);
    assert.equal((await rpc({org:ids.org,resource:'categories',query:'100%_ *special*'})).data.length,0);
    assert.equal((await rpc({org:ids.org,resource:'categories',query:'*special* 100%_',active_only:false})).data[0].id,category);
    assert.equal((await rpc({org:ids.org,resource:'categories',query:'does not match',selected:category})).data[0].active,false);
    assert.equal((await rpc({org:ids.org,resource:'subcategories',parent:category})).data[0].id,child);
    assert.equal((await rpc({org:ids.org,resource:'subcategories',selected:child,parent:ids.otherOrg})).data.length,0);
    assert.equal((await rpc({org:ids.otherOrg,resource:'people'})).data.length,0);
    await identity(db,'authenticated',ids.employee);
    assert.equal((await rpc({org:ids.org,resource:'people'})).data.length,0);
    assert.equal((await rpc({org:ids.org,resource:'teams'})).data.length,0);
    assert.ok((await rpc({org:ids.org,resource:'categories'})).data.length>0);
    await owner(db);
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values(gen_random_uuid(),$1,'verified','totp')",[ids.admin]);
    await identity(db);
    assert.equal((await rpc({org:ids.org,resource:'people'})).data.length,0);
    await owner(db);
    const grants = await db.query("select has_function_privilege('anon','public.lookup_choices(uuid,text,text,text,uuid,uuid,uuid,boolean)','execute') allowed, prosecdef from pg_proc where oid='public.lookup_choices(uuid,text,text,text,uuid,uuid,uuid,boolean)'::regprocedure");
    assert.deepEqual(grants.rows[0],{allowed:false,prosecdef:false});
  } finally { await db.close(); }
});
