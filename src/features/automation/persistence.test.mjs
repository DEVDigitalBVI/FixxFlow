import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { persistenceDefinitions } from '../../../tests/fixtures/automation-persistence.mjs';
import { validateDefinition } from '../../../tests/fixtures/automation.mjs';

test('automation persistence on a clean PostgreSQL migration replay', async t => {
  const db = await migratedPostgres();
  try {
    await t.test('database catalog exactly matches the registered Stage 1 domain adapters', async () => {
      const { persistenceCatalog } = load('src/features/automation/persistence-contract.ts');
      assert.deepEqual((await db.query('select private.automation_definition_catalog() as catalog')).rows[0].catalog, persistenceCatalog);
    });
    await t.test('database validator matches canonical Stage 1 definitions and adversarial inputs', async () => {
      const { persistenceRegistry } = load('src/features/automation/persistence-contract.ts');
      const { valid, invalid } = persistenceDefinitions();
      for (const [expected, candidates] of [[true, valid], [false, invalid]]) for (const candidate of candidates) {
        const result = validateDefinition(candidate, persistenceRegistry);
        assert.equal(result.valid, expected, JSON.stringify(candidate));
        if (expected) assert.deepEqual((await db.query('select private.validate_automation_definition($1::jsonb) as definition', [JSON.stringify(candidate)])).rows[0].definition, result.value);
        else await assert.rejects(db.query('select private.validate_automation_definition($1::jsonb)', [JSON.stringify(candidate)]), { code: '22023' }, JSON.stringify(candidate));
      }
      await assert.rejects(db.query('select private.validate_automation_definition(null)'), { code: '22023' });
      t.diagnostic(`${valid.length} valid and ${invalid.length} malformed definitions agree with Stage 1.`);
    });
    await t.test('persistence row and RPC type extensions match migrated schema', async () => {
      const source = ts.createSourceFile('schema.ts', await readFile('src/types/automation-database.ts', 'utf8'), ts.ScriptTarget.Latest, true);
      const alias = name => source.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === name).type;
      for (const [table, type] of [['automation_rules', 'AutomationRuleRow'], ['automation_rule_versions', 'AutomationVersionRow']]) {
        const columns = (await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2', ['public', table])).rows.map(row => row.column_name).sort();
        assert.deepEqual(columns, alias(type).members.map(member => member.name.getText(source)).sort());
      }
      for (const fn of alias('AutomationFunctions').members) {
        const name = fn.name.getText(source); const args = fn.type.members.find(member => member.name.getText(source) === 'Args').type;
        const members = ts.isIntersectionTypeNode(args) ? args.types.flatMap(node => ts.isTypeReferenceNode(node) ? alias(node.typeName.getText(source)).members : node.members) : ts.isTypeReferenceNode(args) ? alias(args.typeName.getText(source)).members : args.members;
        const actual = (await db.query('select proargnames from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname=$1 and proname=$2', ['public', name])).rows[0].proargnames;
        assert.deepEqual(actual.sort(), members.map(member => member.name.getText(source)).sort());
      }
    });
    await t.test('generic value schemas retain Stage 1 semantics independently of ticket fields', async () => {
      const { matchesValue } = load('src/features/automation/values.ts');
      for (const schema of [{ kind: 'boolean' }, { kind: 'number', min: 0, max: 100, integer: true }, { kind: 'number' }, { kind: 'string_set', maxItems: 3, itemMaxLength: 4 }, { kind: 'string', minLength: 1, maxLength: 4 }]) {
        for (const value of [null, true, false, 0, 1.5, -1, 101, 9007199254740992, ' ', '\ufeff', '😀😀', '😀😀😀', [], ['a', 'b'], ['a', 'a'], [''], ['     '], ['a', 'b', 'c', 'd'], ['a', 1]]) {
          const { rows } = await db.query('select private.automation_value_valid($1::jsonb,$2::jsonb) as valid', [JSON.stringify(value), JSON.stringify(schema)]);
          assert.equal(rows[0].valid, matchesValue(value, schema), JSON.stringify({ value, schema }));
        }
      }
    });
    for (const [name, file] of [['tenant isolation, roles, MFA, versions, stale edits, lifecycle, audit, bypasses', 'automation'], ['tenant reference validation across all fields/actions and inactive targets', 'automation-references'], ['existing security regression suite', 'security-regression']]) {
      await t.test(name, async () => { await db.exec(await readFile(`supabase/tests/${file}.sql`, 'utf8')); });
    }
    await t.test('existing audit regression suite', async () => {
      // The unchanged suite requires an existing active administrator and profile.
      await db.exec(`insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000701','audit-baseline@example.invalid');
        insert into public.organizations(id,name,slug) values ('20000000-0000-0000-0000-000000000701','Audit baseline','audit-baseline');
        insert into public.organization_memberships(organization_id,user_id,role) values ('20000000-0000-0000-0000-000000000701','10000000-0000-0000-0000-000000000701','administrator');
        insert into public.profiles(organization_id,user_id,display_name) values ('20000000-0000-0000-0000-000000000701','10000000-0000-0000-0000-000000000701','Baseline administrator');`);
      await db.exec(await readFile('supabase/tests/audit_log.sql', 'utf8'));
    });
  } finally { await db.close(); }
});
