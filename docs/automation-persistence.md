# Automation persistence — Stage 2

Stage 2 persists and administers definitions. It does not publish domain events,
execute actions, deliver notifications, schedule workers, provide dry runs, or
add an Automation UI. All existing Stage 1 core files and contracts are unchanged.

## Application boundary

`src/features/automation/admin-service.ts` exposes list, get, versions, create,
update, duplicate, set-enabled and archive operations. Every operation calls the
existing `requireViewer()` authentication/MFA flow and requires an active tenant
administrator. Callers do not supply an organization or actor. The service passes
the viewer's organization to `repository.ts`, using the ordinary session Supabase
client; no service-role client or new server action endpoint is introduced.

The repository scopes every read, returns at most 50 records per page, and writes
only through RPCs. Failures become safe discriminated results: `forbidden`,
`invalid_input`, `invalid_definition`, `conflict`, `not_found`, `archived`, or
`unavailable`. Authentication redirects and unexpected programming errors remain
observable. Database/provider details are never copied into these error results.

`persistence-model.ts` surrounds the exact Stage 1 `AutomationRule` with
`updatedBy`, `enabledAt` and `archivedAt`. Definitions remain schema version 1,
with a flat AND group and actions ordered by explicit position. The recursive
condition storage representation is unchanged; OR/nested behavior is still denied.

`persistence-contract.ts` is a composition root for the existing trusted domain
registries. The pure core remains domain agnostic. The SQL registry is a private
immutable JSON catalog, mirrored from this composition root and compared in tests.
SQL validation uses allowlisted properties, registered operators/value schemas,
bounded JSON, unique identifiers, compatible actions and contiguous ordering.
Literal note text is data. No rule supplies SQL, JavaScript, a function name,
table name or another executable expression.

## Migrations and schema

Apply in order:

1. `20261001014435_automation_rule_definitions.sql`
2. `20261001014436_automation_administration_audit.sql`

`automation_rules` stores `id`, `organization_id`, the validated canonical JSONB
`definition`, generated metadata projections (`name`, `description`,
`trigger_type`, `trigger_configuration`, `conditions`, `actions`), `enabled`,
`version`, `created_by`, `updated_by`, `created_at`, `updated_at`, `enabled_at` and
`archived_at`. Organization and creator/updater references use the existing tenant
membership model. A check prevents enabled archived rules; disabled rules have no
enablement timestamp. New/duplicated rules always start disabled at version 1.

`automation_rule_versions` has primary key `(organization_id, rule_id, version)`,
a composite FK to the rule, the entire immutable definition and lifecycle state,
and the revision actor/time. A future execution can FK to this exact identity.
Nothing cascades away rule history. Membership/organization hard deletion is
restricted when history refers to it; normal membership deactivation still works.

Indexes cover tenant list ordering, active trigger lookup, and membership FKs.
The version primary key supports both tenant-scoped history and future execution
references. No backfill is required, because these are new tables.

`src/types/automation-database.ts` extends the checked-in generated database type
without rewriting its hosted snapshot. Column names and RPC signatures are checked
against migration replay. Application Insert/Update types are `never`, matching
RPC-only writes. Regenerate/consolidate these types when the normal local Supabase
generation workflow becomes available.

## Authorization, RLS and reference validation

Both tables enable RLS and grant authenticated users SELECT only:

| Policy | Table | Behavior |
| --- | --- | --- |
| `automation_rules_admin_read` | rules | Active tenant administrator via `private.has_organization_role` |
| `automation_rules_mfa` | rules | Restrictive SELECT via `private.has_required_assurance` |
| `automation_versions_admin_read` | versions | Active tenant administrator via the same role helper |
| `automation_versions_mfa` | versions | Restrictive SELECT via the same assurance helper |

There are no client INSERT/UPDATE/DELETE policies or grants. Anon and service_role
receive no automation table or management RPC permissions. Platform ownership
alone grants nothing. Existing assurance semantics are preserved: enrolled users
need aal2; unenrolled users follow the existing `has_required_assurance()` policy.

Public invoker RPCs delegate to `private.manage_automation_rule`, a definer with
an empty search path. It checks `auth.uid()`, MFA and an active administrator
membership, then derives the working organization from that matching membership.
The organization argument is a selector, never authorization. Membership and
reference locks prevent concurrent deletion/deactivation during a successful
write. The private entry point has the same checks if called directly from SQL;
the private schema is not exposed in the configured Data API.

Reference dispatch is application-owned (`automation_reference_exists`), with a
ticket adapter for staff memberships, requesters, teams, categories,
subcategories, departments and locations. Conditions, including negative/list
operators, cannot contain another organization's references. Historical inactive
values may be used in conditions; action targets must be active, and technician
targets must be technicians/administrators. Create, update, duplicate and enable
revalidate references. Disable/archive remain available even if targets have
since become unavailable. JSON references are not relational FKs; later execution
must revalidate them at execution time under the tenant scope.

## RPCs, versioning and audit

| RPC | Additional inputs |
| --- | --- |
| `create_automation_rule` | definition |
| `update_automation_rule` | rule_id, expected_version, definition |
| `duplicate_automation_rule` | rule_id, expected_version, name |
| `set_automation_rule_enabled` | rule_id, expected_version, enabled |
| `archive_automation_rule` | rule_id, expected_version |

Every RPC also takes `target_organization_id`, supplied only from the trusted
viewer by the service and independently checked in SQL. No RPC accepts an actor,
timestamp, replacement version, arbitrary lifecycle fields or policy override.

Mutations lock the scoped rule with `FOR UPDATE`, compare `expected_version`, then
update the rule, insert its version and audit the change in one transaction.
Stale requests return SQLSTATE 40001, surfaced as a recoverable `conflict` result.
Do not retry this result automatically using a freshly fetched version: the
administrator must reconcile the edit. Metadata, definition, enable/disable and
archive changes all advance the token; exact no-ops do not. Archived rules cannot
be edited, re-enabled or duplicated. Hard delete and version UPDATE/DELETE are
blocked by the existing append-only trigger function.

The existing `audit_events` table receives `entity_type='automation_rules'` and
`created`, `updated`, `enabled`, `disabled`, or `deleted` (archive) actions. Its
action check is extended to allow enabled/disabled. Records contain tenant,
verified actor and display name, rule ID/name, version and lifecycle deltas.
Definitions, descriptions, condition values and action bodies are excluded.
Existing audit RLS and immutability remain unchanged. Audit and revision failures
roll back the active mutation. Execution history is not introduced here.

## Verification and limitations

`npm test` includes clean migration replay, the existing security/audit SQL suites,
new SQL lifecycle/isolation/reference suites, catalog and validator parity tests,
schema-signature checks and service/repository tests. Direct SQL cases can also
run with `psql -v ON_ERROR_STOP=1 -f supabase/tests/automation.sql` and the analogous
`automation-references.sql` command against a disposable, migrated local database.
Both SQL files roll all fixtures back.

The test-only pinned `@electric-sql/pglite` dependency supplies real PostgreSQL
18.3. `tests/fixtures/supabase-bootstrap.sql` supplies minimal platform-owned
auth/storage/realtime schemas and roles; every application migration runs verbatim.
This machine has no Docker/PostgreSQL installation, so a full clean Supabase reset
could not run. The project targets PostgreSQL 17: repeat the SQL suites there,
verify PostgREST composite RPC `.single()` responses, and exercise two simultaneous
sessions before deployment. The embedded harness verifies stale version rejection
but cannot reproduce contention across independent connections. It does not
validate JWT signatures or simulate external Supabase services/cron extensions.

PostgreSQL JSONB cannot encode NUL or unpaired Unicode surrogates. Those transport
failures produce safe invalid-definition results without changing Stage 1's pure
JSON model. Ordinary Unicode length/whitespace handling mirrors JavaScript,
including astral characters and Unicode whitespace.

## Later-stage handoff

- Keep event/execution transport independent of definitions and revision keys.
  Record `(organization_id, rule_id, version)` permanently on future executions.
- Treat all definition and lifecycle revisions as concurrency changes. Always
  query `enabled AND archived_at IS NULL` for active rules.
- Add narrowly scoped runtime capabilities separately; do not grant generic
  service-role writes or bypass administrator management authorization.
- Revalidate target tenant, availability and permissions at execution time;
  references can change after a rule is saved. Priority-driven SLA remains
  authoritative; tagging and explicit SLA actions remain unavailable.
- Add future domains via trusted registrations, a catalog migration and reference
  adapter dispatch. Update parity fixtures in the same change. Do not replace
  historical version definitions when changing registrations; future compatibility
  changes need an explicit schema-version/migration policy.
- The existing audit UI has only created/updated/deleted filter choices. Its
  unfiltered timeline renders the new records, but automation labels and
  enabled/disabled filters belong in the later approved UI stage.

No Stage 3 implementation is included.

## Stage 2 completion record

Created:

- `src/features/automation/admin-service.ts`
- `src/features/automation/repository.ts`
- `src/features/automation/persistence-contract.ts`
- `src/features/automation/persistence-model.ts`
- `src/features/automation/admin-service.test.mjs`
- `src/features/automation/persistence.test.mjs`
- `src/types/automation-database.ts`
- `supabase/migrations/20261001014435_automation_rule_definitions.sql`
- `supabase/migrations/20261001014436_automation_administration_audit.sql`
- `supabase/tests/automation.sql`
- `supabase/tests/automation-references.sql`
- `tests/fixtures/automation-persistence.mjs`
- `tests/fixtures/supabase-bootstrap.sql`
- `tests/helpers/postgres.mjs`
- `docs/automation-persistence.md`

Modified: `src/types/database.ts`, `package.json`, `package-lock.json`.

Final checks: `npm run typecheck` passed; `npm run lint -- --max-warnings=0`
passed with zero warnings; `npm test` passed all 346 tests, with no failures or
skips (317 baseline tests plus 29 Stage 2 tests/subtests). Database checks include
75 valid and 180 malformed definition parity cases and 100 generic value-schema
comparisons, plus transactional SQL assertions for both tenant directions, roles,
MFA, fully verified platform ownership, references, lifecycle, immutable revisions,
stale edits, direct-write/RPC bypasses and audit/revision-failure atomicity.
Existing `security-regression.sql` and `audit_log.sql` passed unchanged.
All 28 migrations replayed from an empty embedded database. `git diff --check`
passed. Checks ran on the available Node 26.8.2; the project declares Node 24.x.
Existing module-type Node warnings remain; these are separate from ESLint results.

The dependency install's advisory check identified an existing critical advisory
for the unchanged Next.js 16.3.5 dependency:
[GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), concerning
`next/og` ImageResponse. No direct `next/og`/`ImageResponse` references were found
under `src`; exploitability was not assessed. Address the dependency separately.
The new test dependency had no reported advisory. No hosted database was modified.
