# Automation storage and database contracts

## Automation persistence — Stage 2

Stage 2 persists and administers definitions. It does not publish domain events,
execute actions, deliver notifications, schedule workers, provide dry runs, or
add an Automation UI. All existing Stage 1 core files and contracts are unchanged.

### Application boundary

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

### Migrations and schema

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

### Authorization, RLS and reference validation

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

### RPCs, versioning and audit

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

### Verification and limitations

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

### Later-stage handoff

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

### Stage 2 completion record

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
- `docs/automation/storage.md`

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

<a id="execution-storage"></a>

## Automation execution storage and trusted ticket commands — Stage 4

Stage 4 introduces database authority and atomic ticket commands. It installs no
worker, cron, notification action, dry run, administration UI, or historical
replay. Processing is **off** after migration. Stage 1 models and Stage 2 rule
management APIs are unchanged. Stage 3 capture and delivery APIs remain intact.

### Files and schema

Migrations:

- `20261001022623_automation_execution_authority.sql`: execution/step storage,
  processing state, chain claims, condition/trigger checks, admission RPC and RLS.
- `20261001023010_automation_ticket_commands.sql`: validated transaction authority,
  ticket command RPC, constrained note authorship and provenance triggers.

Public tables:

- `automation_executions`: organization, rule ID and exact immutable version FK,
  pinned rule name, event and delivery FKs, entity identity, correlation/cause/root/
  depth, processing generation, expected entity revision, start/completion/duration,
  status, condition results, attempted-action count and allowlisted error code.
  `(organization_id,event_id,rule_id)` is unique, independent of rule version.
- `automation_execution_steps`: organization/execution, exact configured action
  ID/type/position, stable UUID idempotency key, attempt count, status/timing,
  allowlisted result receipt and error code. Execution/action and execution/position
  are unique. Tenant keys are composite. Configurations and note bodies are not
  copied into execution history; the immutable version is authoritative.

Private tables:

- `automation_processing_state`: single operational activation gate, cutoff time
  and monotonically increasing activation generation.
- `automation_chains`: bounded execution/action counts per organization/correlation.
- `automation_chain_claims`: one claim per organization/correlation/rule/entity.
- `automation_command_contexts`: authority keyed by PostgreSQL transaction ID,
  referencing a persisted execution/step. Present only during an authorized command;
  successful completion deletes it, and transaction rollback removes it.
- `automation_version_visibility`: immutable private transaction markers for rule
  revisions. Existing revisions are backfilled at installation while processing is
  off; a trigger records new markers without changing the Stage 2 tables or APIs.

History, version, delivery, correlation, cause, root, note/execution and chain
indexes accompany the foreign keys and uniqueness constraints. Domain events gain
a tenant-composite FK for their reserved automation execution ID.
Private events also retain a capture transaction ID and visibility snapshot. These
infrastructure fields do not change the public domain event envelope.

`ticket_messages.author_id` becomes nullable only for the constrained automation
authorship variant. Added fields are `author_type`, `automation_execution_id`,
`automation_step_id`, and `automation_name`. Existing human rows default to member
authorship and retain their required human ID. One note per step is enforced.
Automation-authored notes cannot subsequently be updated or deleted, preserving
their provenance and the action receipt; a future retention workflow must account
for that deliberate restriction.

Other new files:

- `src/types/automation-execution-database.ts`: database row and RPC contracts;
  direct Insert/Update types are `never`.
- `src/features/automation/execution-records.ts`: maps persisted records into the
  unchanged Stage 1 models and maps safe error codes to fixed explanatory text.
- `src/features/automation/execution-database.test.mjs`: clean migration replay,
  behavioral/security/atomicity tests, schema signature and evaluator parity tests.
- `src/features/tickets/authorship.ts`: shared human/system/automation labels.

Modified files: `src/types/database.ts`, the ticket detail page, existing
`ConversationTimeline`, `HistoryBrowser`, and conversation tests. These small
presentation changes prevent automation notes from appearing to be human-authored.
They add no controls, styling, layout, administration screens, or mutations.

### Backlog eligibility

`private.set_automation_processing(boolean)` is an **owner-only operational**
function. It is not granted to service_role, authenticated, or anonymous callers.
A false-to-true transition records database wall-clock time and advances the
generation. It is never called by these migrations.

For a new execution, all of the following must hold:

1. The persisted delivery has a live automation-consumer lease matching the token.
2. The same-tenant rule is currently enabled, unarchived, and at the requested
   immutable version. Its trigger is compatible with the persisted event.
3. Processing is active.
4. `event.occurred_at > greatest(processing.activated_at, rule.enabled_at,
   immutable_version.created_at)`. Equality is ineligible. Claim/retry time never
   substitutes for occurrence time.
5. The chain has capacity and no existing claim for this rule/entity.
6. The revision's transaction and processing activation transaction were visible
   in the event's capture snapshot (or occurred earlier in that same transaction,
   still subject to the strict timestamp cutoff).

This deliberately discards eligibility for events before activation, before
enablement/re-enablement, and before the currently selected revision. Editing an
enabled rule does not retroactively apply the new definition to queued events.
An existing execution always returns its pinned version; it is never re-pinned.
Each subsequent command also checks processing generation and current rule state:
editing, disabling, archiving, or reactivating processing stops unfinished work.
No caller can supply a historical cutoff or request a replay.

Cutoffs use existing Stage 2 database timestamps, not client timestamps. Private
visibility markers additionally reject an event created while enablement or
activation was uncommitted, even if timestamp ordering alone would accept it.
The implementation uses PostgreSQL's top-level transaction IDs and snapshot
visibility functions, documented for [PostgreSQL 17](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-SNAPSHOT).
Tests cover synthetic in-progress snapshots and successive committed transactions;
they do **not** resolve the real concurrent-session verification gap.

### Admission and command authorization

Service-only public RPCs delegate to private definer functions with an empty
search path. Both check the actual database role, not a caller-provided JWT role.

- `begin_automation_execution(delivery_id, token, rule_id, rule_version)` derives
  tenant/entity/event context from the locked delivery. It pins the immutable
  version, independently checks trigger compatibility, evaluates its flat AND
  conditions against the persisted event snapshot, claims the chain, and creates
  ordered steps. Nonmatching/invalid-context conditions produce `skipped` history
  and `not_attempted` steps, with no mutation authority.
- `execute_automation_ticket_step(execution_id, token, command)` accepts an assertion
  `{organizationId,entityId,action}`. The complete action must exactly equal the
  configured action in the pinned version, including ID, type, position and
  configuration. These caller fields never confer authority.

The command independently validates delivery ownership/event/consumer/token/expiry,
execution organization, pinned version, event/entity/type/correlation/trigger,
step identity, execution/step state, and predecessor completion. It locks the
ticket in the derived tenant, checks revision, and reuses Stage 2's locked current
reference adapter for technician/team/category validation. Lease expiry is checked
after blocking locks and before successful receipt storage. There is no arbitrary
field mutation or executable JavaScript/SQL in definitions.

Only then does it insert the private transaction authority record. The employee
update guard explicitly recognizes this validated system path. It does not depend
on `can_work_tickets()` returning NULL. Normal authenticated employee restrictions
remain the same. Definer rights on this trigger allow private authority inspection;
the trigger itself does not grant table writes or bypass the caller's RLS.

GUCs carry the existing Stage 3 delivery/causation identifiers only within this
command. They cannot fabricate the private authority row. A service JWT subject
is temporarily cleared for existing history/notification triggers and restored
before returning; automation cannot impersonate that human or suppress their
assignment notification as if they performed the mutation.

### Conditions and domain boundaries

Stage 1 TypeScript validation/evaluation/planning is unchanged. Database admission
adds a pure structured comparator and condition result builder using the existing
trusted catalog. Snapshot nullability and trigger predicates are adapter checks;
the generic tables, claims, comparison and condition result model have no ticket
columns. The dispatcher currently registers only the ticket adapter.

NULL never matches a value comparison, including negative operators. Missing or
invalid snapshot values fail closed. Conditions store outcomes/identifiers, not
their potentially sensitive values. SQL parity tests cover all registered operators
and invalid contexts. Native PostgreSQL `lower()` differs from JavaScript for dotted
I and contextual sigma, so a trusted frozen Unicode lowercase mapping implements
the JavaScript behavior without depending on database collation. The mapping is
Unicode 17 (the available Node 26 runtime); the parity test checks both runtime
and stored mappings. **Run this gate under declared Node 24 before deployment and
regenerate the trusted mapping from that runtime if its Unicode data differs.**
This version-alignment verification remains part of the existing Node environment
gap; it must not be dismissed as a cosmetic test difference.

Future domains register their event predicate/snapshot nullability and trusted
command adapter through migrations. They reuse execution and delivery contracts.
Changing transport latency does not require changing definitions or history.

### Ticket semantics and stale state

All six Stage 4 actions require `ticket.revision = execution.expected_entity_revision`.
Admission initializes this from the event revision. Each successful action stores
the ticket's resulting revision for the next action. A human change before/between
actions fails the next action with `stale_entity` and stops the remainder. Even
apparently harmless no-op commands and internal notes use this conservative check.
Conditions remain evaluations of the frozen event snapshot, not later requester
profile changes. Current action targets are always revalidated independently.

| Action | Existing behavior preserved |
| --- | --- |
| assign_technician | Active same-tenant technician/administrator membership; normal assignment history and notifications. |
| assign_team | Active same-tenant team; explicit assignment sets existing routing mode to manual. |
| set_priority | Existing priority enum and authoritative SLA preparation/recalculation. |
| set_status | Existing status enum and existing resolution/closing/reopening timestamp preparation; no new transition graph. |
| set_category | Active same-tenant category. The Stage 1 action takes only `categoryId`; changing category clears the old subcategory, while an unchanged category preserves it. Existing composite classification FK remains authoritative. Category changes do not add rerouting behavior. |
| add_internal_note | Staff-only note with NULL human author and pinned automation name/execution/step. It does not satisfy first response or emit a public-reply notification. |

An intervening internal note alone does not change the existing ticket revision;
a public staff reply that sets first response does. No revision trigger or ticket
write path is replaced. Existing routing, SLA, activity, audit, notification and
outbox triggers execute in the same transaction. Stage 1 `send_notification` stays
registered for later work but fails closed with `unsupported_action` here.

### Atomicity, failure and provenance

The ticket mutation (or note insertion), all triggered effects, revision advancement
and successful step receipt live in one database subtransaction. If any part fails,
all of that action's effects roll back. The outer transaction records a fixed safe
failure code, never SQLERRM, SQL detail, note content or provider data.

Completed steps return their existing receipt without repeating side effects,
including after a delivery is reclaimed with a new valid token. Wrong/expired
tokens cannot mutate. A lost transaction rolls back both action and receipt; a
lost response after commit returns the receipt on retry. Each committed attempt is
final in V1: failed steps are not retried, and later steps become `not_attempted`
with zero attempts and no start time. Earlier successes remain visible; execution
status becomes `partially_completed` or `failed`. No configurable failure policy.

Automation events retain the existing envelope and receive `actorType=automation`,
NULL actor ID, execution ID, parent event ID and its correlation/root with depth+1.
Existing activity details gain `automationExecutionId`/`automationName`. Existing
audit records receive the safe `Automation: <pinned name>` actor label without note
bodies or a parallel audit log. Conversation/history uses that textual label and
the existing staff-only filters, escaping name/body content as before.

### Chain bounds and security policies

- Unique organization/event/rule admission, independent of revision.
- Unique execution/action ID and position; stable idempotency receipt.
- One organization/correlation/rule/entity claim, including nonmatches, prevents
  repeatedly re-evaluating the same rule/entity in a causal chain.
- Incoming depth must be below 8; a depth-8 child event can be stored but not admitted.
- At most 32 executions and 100 action attempts per organization/correlation.
- Locked chain rows serialize budget consumption; no retry orchestration is added.

All new tables enable RLS. Private runtime tables have no client/service policies
and no direct grants. Public execution tables grant authenticated SELECT only,
with `automation_execution_admin_read` / `automation_step_admin_read` and restrictive
`automation_execution_mfa` / `automation_step_mfa`. Existing active tenant-role and
assurance helpers remain authoritative. Technicians, end users, cross-tenant admins
and implicit platform-owner authority cannot read execution details. Service access
is via the two constrained RPCs, not direct table SELECT/INSERT/UPDATE/DELETE.

Automation provenance columns are excluded from human insert/update grants and
checked by constraints plus trusted triggers. Service note insertion must use the
validated automation path. Historical rule versions and audit protections remain
unchanged. Execution records and pinned versions have no cascade deletion policy.

### Verification and remaining gates

Final checks in this workspace:

- `npm test`: **419 passed, 0 failed, 0 skipped**, including 37 Stage 4 tests/
  subtests, 278 condition-result parity cases and the new conversation attribution
  assertion. Clean replay and upgrading pre-existing Stage 3 data both passed.
- Existing Stage 1/2/3, audit/security, routing/SLA/notification, employee reopening
  and conversation regressions passed.
- `npm run typecheck`: passed.
- `npm run lint -- --max-warnings=0`: passed with zero warnings.
- Tracked and newly created file whitespace/diff checks: passed.

Apply both migrations before deploying the changed conversation readers, which
select the new provenance fields. Leave processing off during rollout. Adding
capture metadata backfills the private event table; plan a migration lock window
appropriate to its size. No production migration or activation was performed here.

The Stage 4 suite replays every migration into a fresh PostgreSQL test database.
It tests six actions, tenant/MFA/role boundaries, persisted-context assertions,
cross-tenant/inactive references, classification constraints, stale/partial failure,
lease reclaim, idempotency, atomic receipt failures, note provenance, safe errors,
backlog/version cutoffs, chain bounds, condition parity and schema signatures.
Existing Stage 1–3, routing, SLA, notifications, employee reopening, conversation,
security and audit suites are retained and run unchanged except the added
conversation-authorship assertion.

The test substrate is PGlite PostgreSQL 18.3 with test-only Supabase platform
schemas. It is not Supabase PostgreSQL 17, PostgREST, or concurrent independent
sessions. Node available here is 26.8.2; the repository declares 24.x. These gaps
remain open. No hosted database migration was applied. UI verification consists
of existing rendering/visibility tests and type checking; no new browser/screen
reader/viewport inspection is claimed for the attribution-only text change.

Before Stage 5 activation: verify real PostgREST return shapes/permissions and
multi-session lease/chain/optimistic-lock races; run declared Node/PG versions and
the Unicode parity gate; add explicit worker terminalization of abandoned running
executions when a delivery exhausts retries. Stage 5 should use database admission
as authority, handle ineligible/chain-blocked events without replay, and acknowledge
only after all eligible rule work for the delivery is settled. It must not treat
the pure planner as authorization or retry failed V1 steps.

No existing model contract was redesigned. The only presentation scope is truthful
automation attribution in existing conversation/history components. Existing tokens,
native semantics, responsive layout and focus behavior are reused; no design-system
exception or new UI interaction was introduced.
