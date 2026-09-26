import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function load(file, { role = 'administrator', responses = [{ data: { id: 'row' }, error: null }] } = {}) {
  const calls = [];
  let index = 0;
  const query = new Proxy({}, { get: (_, key) => key === 'then'
    ? resolve => Promise.resolve(responses[Math.min(index++, responses.length - 1)]).then(resolve)
    : (...args) => { calls.push([key, ...args]); return query; } });
  const mocks = {
    'next/cache': { revalidatePath: (...args) => calls.push(['revalidate', ...args]) },
    'next/navigation': { redirect: path => { throw new Error(`Unexpected redirect: ${path}`); } },
    '@/lib/auth/viewer': { requireViewer: async () => ({ id: 'viewer', role, organizationId: 'our-org' }) },
    '@/lib/supabase/server': { createClient: async () => ({ from: table => { calls.push(['from', table]); return query; }, rpc: (...args) => { calls.push(['rpc', ...args]); return query; } }) },
    '@/lib/supabase/admin': { createAdminClient: () => { throw new Error('Unexpected elevated client'); } },
  };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => mocks[name] ?? require(name), compiledModule, compiledModule.exports);
  return { actions: compiledModule.exports, calls };
}
const form = values => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const settings = 'src/app/app/administration/actions.ts';
const organization = 'src/app/app/organization/actions.ts';
const people = 'src/app/app/people/actions.ts';
const tickets = 'src/app/app/tickets/actions.ts';

test('all new management actions reject non-administrators before accessing data', async () => {
  for (const role of ['end_user', 'technician']) for (const [file, method] of [[settings, 'saveClassification'], [organization, 'editOrganizationItem'], [people, 'updateMemberDetails']]) {
    const { actions, calls } = load(file, { role });
    assert.match((await actions[method](form({}))).error, /Only administrators/);
    assert.deepEqual(calls, []);
  }
});

test('classification edits scope tenant, record and version; deactivation never deletes history', async () => {
  const { actions, calls } = load(settings);
  assert.ok((await actions.saveClassification(form({ kind: 'teams', id: 'team', name: 'Service desk', isActive: 'false', updatedAt: 'version' }))).success);
  for (const pair of [['organization_id', 'our-org'], ['id', 'team'], ['updated_at', 'version']]) assert.ok(calls.some(call => call[0] === 'eq' && call[1] === pair[0] && call[2] === pair[1]));
  assert.deepEqual(calls.find(call => call[0] === 'update')[1], { name: 'Service desk', is_active: false });
  assert.ok(!calls.some(call => call[0] === 'delete'));
});

test('classification creation validates kind, names and parent category before writing', async () => {
  for (const values of [{ kind: 'profiles', name: 'Invalid' }, { kind: 'teams', name: '  ' }, { kind: 'teams', name: 'x'.repeat(101) }]) {
    const { actions, calls } = load(settings);
    assert.ok((await actions.saveClassification(form(values))).error);
    assert.deepEqual(calls, []);
  }
  const { actions, calls } = load(settings, { responses: [{ data: null, error: null }] });
  assert.match((await actions.saveClassification(form({ kind: 'ticket_subcategories', name: 'Access', categoryId: 'foreign-category' }))).error, /category is unavailable/);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'our-org'));
  assert.ok(!calls.some(call => call[0] === 'insert'));
});

test('classification errors distinguish duplicate names, conflicts and save failures', async () => {
  for (const [response, expected] of [[{ data: null, error: { code: '23505' } }, /already exists/], [{ data: null, error: null }, /changed or was removed/], [{ data: null, error: { code: 'network' } }, /preserved/]]) {
    const { actions, calls } = load(settings, { responses: [response] });
    assert.match((await actions.saveClassification(form({ kind: 'teams', name: 'Support', id: 'team', updatedAt: 'old' }))).error, expected);
    assert.ok(!calls.some(call => call[0] === 'revalidate'));
  }
});

test('organization edits validate timezone and country code and detect stale records', async () => {
  for (const values of [{ countryCode: 'INVALID', timezone: 'America/Tortola' }, { countryCode: 'VG', timezone: 'Mars/Olympus' }]) {
    const { actions, calls } = load(organization);
    assert.ok((await actions.editOrganizationItem(form({ kind: 'locations', name: 'Main office', ...values }))).error);
    assert.deepEqual(calls, []);
  }
  const { actions, calls } = load(organization, { responses: [{ data: null, error: null }] });
  assert.match((await actions.editOrganizationItem(form({ kind: 'departments', id: 'dept', name: 'IT', updatedAt: 'old' }))).error, /changed or was removed/);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'updated_at' && call[2] === 'old'));
});

test('member details reject unavailable assignments and preserve existing inactive assignments', async () => {
  const current = { data: { department_id: 'old-dept', location_id: null }, error: null };
  const denied = load(people, { responses: [current, { data: null, error: null }] });
  assert.match((await denied.actions.updateMemberDetails(form({ userId: 'member', departmentId: 'foreign-dept' }))).error, /active department/);
  assert.ok(!denied.calls.some(call => call[0] === 'update'));
  const permitted = load(people, { responses: [current, { data: { user_id: 'member' }, error: null }] });
  assert.ok((await permitted.actions.updateMemberDetails(form({ userId: 'member', departmentId: 'old-dept', updatedAt: 'version' }))).success);
  assert.deepEqual(permitted.calls.filter(call => call[0] === 'from').map(call => call[1]), ['profiles', 'profiles']);
  assert.ok(permitted.calls.some(call => call[0] === 'eq' && call[1] === 'updated_at' && call[2] === 'version'));
});

test('ticket creation returns recoverable errors instead of redirecting away from input', async () => {
  const invalid = load(tickets);
  assert.ok((await invalid.actions.createTicket(form({ title: 'x', description: 'Details' }))).error);
  assert.deepEqual(invalid.calls, []);
  const failed = load(tickets, { responses: [{ data: null, error: { code: 'network' } }] });
  assert.match((await failed.actions.createTicket(form({ title: 'Wi-Fi issue', description: 'My detailed problem' }))).error, /preserved/);
});

test('employee intake uses own identity, ignores staff-only fields and returns a durable request link', async () => {
  const { actions, calls } = load(tickets, { role: 'end_user', responses: [{ data: { id: 'ticket-id' }, error: null }] });
  const result = await actions.createTicket(form({ title: 'Wi-Fi issue', description: 'Details', requesterId: 'someone-else', teamId: 'foreign-team', assignedTechnicianId: 'worker', dueAt: 'tomorrow', locationId: 'location' }));
  assert.match(result.redirectTo, /\/app\/tickets\/ticket-id/);
  const inserted = calls.find(call => call[0] === 'insert')[1];
  assert.equal(inserted.organization_id, 'our-org'); assert.equal(inserted.requester_id, 'viewer');
  assert.equal(inserted.team_id, null); assert.equal(inserted.assigned_technician_id, null); assert.equal(inserted.due_at, null); assert.equal(inserted.location_id, 'location');
});

test('equipment ticket failure retains the form; success retains the atomic equipment workflow', async () => {
  const failed = load(tickets, { role: 'end_user', responses: [{ data: null, error: { code: 'denied' } }] });
  assert.match((await failed.actions.createTicket(form({ title: 'Laptop issue', description: 'Details', assetId: 'asset' }))).error, /equipment request could not be sent/);
  const success = load(tickets, { role: 'end_user', responses: [{ data: 'ticket-id', error: null }] });
  assert.match((await success.actions.createTicket(form({ title: 'Laptop issue', description: 'Details', assetId: 'asset' }))).redirectTo, /ticket-id/);
  assert.ok(success.calls.some(call => call[0] === 'rpc' && call[1] === 'create_equipment_ticket' && call[2].org === 'our-org'));
  assert.ok(!success.calls.some(call => call[0] === 'insert'));
});


test('staff intake distinguishes automatic, manual team and explicitly unassigned routing', async () => {
  for (const [team, mode, assigned] of [['automatic','automatic',null],['','manual',null],['team','manual','team']]) {
    const { actions, calls } = load(tickets);
    await actions.createTicket(form({title:'Connection issue',description:'Details',teamId:team}));
    const inserted=calls.find(call=>call[0]==='insert')[1];
    assert.equal(inserted.routing_mode,mode); assert.equal(inserted.team_id,assigned);
  }
});

test('category routing accepts only an active team in the administrator organization', async () => {
  const { actions, calls } = load(settings,{responses:[{data:null,error:null}]});
  assert.match((await actions.saveClassification(form({kind:'ticket_categories',name:'Network',defaultTeamId:'foreign-team'}))).error,/active team/);
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='organization_id'&&call[2]==='our-org'));
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='is_active'&&call[2]===true));
  assert.ok(!calls.some(call=>call[0]==='insert'||call[0]==='update'));
});
