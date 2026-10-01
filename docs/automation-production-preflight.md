# Stage 8 — production schema alignment preflight

Read-only production inspection, 2026-10-01. **No production migration, history
repair, backup restore, deployment change or activation was performed.** Preparation
only; a new explicit approval is required before applying production migrations.
Baseline repository commit: `0b70dc8` (Automation Stage 8); initially clean tree.

## Decision

| Check | Result | Evidence |
| --- | --- | --- |
| Project identity | PASS | FixxFlow, `dhuikxkrokowvnvzpihp`, us-west-2, ACTIVE_HEALTHY, PostgreSQL 17.6 (`17.6.1.166`) |
| CLI authentication | BLOCKED | Supabase CLI 2.119.0 `whoami` still returns `AccessTokenRequiredError`, including outside the sandbox |
| Backup/recovery readiness | BLOCKED | No authenticated backup inventory or verified recovery point; do not infer backup availability from project health |
| Migration-history consistency | FAIL | Two historical routing migration version IDs differ; recorded SQL bodies match |
| Application schema comparison | PASS within inspected scope | 1,168 application schema fingerprints match the first 26 local migrations |
| Pending migration static/embedded review | PASS within tested scope | Ten-file upgrade replay succeeds on PGlite PG18.3, processing false/generation 0 |
| Production migration preflight | BLOCKED | Recovery readiness and historical version divergence must be resolved before approval |
| Automation processing | OFF | Vercel flag absent/default OFF; database control and runtime schema are not installed |

The hosted PG17 replay, real PostgREST/JWT/MFA behavior, independent concurrent
sessions and hosted worker/recovery gates remain open. This report does not mark
those gates passed. The previously verified Node 24 and Unicode gates remain closed.

## Histories and exact pending sequence

Local: **36 SQL migrations**; remote: **26**; latest remote `20260927233229`;
latest local `20261001032617`. All 26 remote SQL bodies match local files by exact
source MD5, not just names or whitespace-normalized text. This is an equality
check, not an authenticity signature. Pending-file SHA-256 values are recorded in
[the evidence manifest](automation-production-preflight.json).

| Historical name | Repository version | Production version | Recorded SQL |
| --- | --- | --- | --- |
| category_team_routing | 20260926024707 | 20260926024852 | Exact match: `221f44a3262e0d562ed15a6ef153518c` |
| ticket_routing_insert_permission | 20260926024954 | 20260926025012 | Exact match: `300eff90e5e2e7f652dc60cafac7e343` |

The other 24 versions/names match. No additional unmatched migration content was
found. A strict version-ID comparison sees **12 local-only and 2 remote-only IDs**,
not a clean ten-entry suffix. Two of the local-only files have already been applied
under the production timestamps; replaying them would recreate existing objects.
Do not use `db push --include-all`, mark existing migrations reverted, or use
`migration repair` to conceal this discrepancy.

Recommended separate history-resolution proposal: treat verified production IDs
as canonical and rename the two corresponding repository filenames without changing
their SQL, after checking other environments' ledgers. Renaming does not apply SQL
or alter production history, but is still an explicit repository/history decision.
Do not rename automatically in this preparation step. If another environment has
the local IDs applied, agree a reconciliation procedure for that environment first.

The ten genuinely unapplied Automation files, in exact order:

1. `20261001014435_automation_rule_definitions.sql`
2. `20261001014436_automation_administration_audit.sql`
3. `20261001020338_durable_domain_events.sql`
4. `20261001022623_automation_execution_authority.sql`
5. `20261001023010_automation_ticket_commands.sql`
6. `20261001025400_automation_notification_kind.sql`
7. `20261001025401_automation_worker_delivery.sql`
8. `20261001025402_automation_notification_command.sql`
9. `20261001031036_automation_dry_run_reads.sql`
10. `20261001032617_automation_admin_reads.sql`

## Recovery readiness

The available connector supports read-only SQL inspection and migration management,
but does not expose backup inventory/creation. CLI authentication is still absent.
No credentials were retrieved, displayed or stored in this report. No backup was
created, no recovery point was verified and no restoration was attempted.

| Required recovery evidence | Current finding |
| --- | --- |
| Mechanism: daily physical backup, PITR, or logical export | Unverified for this project |
| Most recent successful recoverable point / retention | Unknown |
| Restorable artifact / recovery owner / restore rehearsal | Not verified |
| RPO / data-loss window / restore duration | Cannot quantify without a recovery point and rehearsal |
| Manual export appropriate? | Yes, if the available platform point is insufficiently recent or independent recovery evidence is needed; availability of a consistent export must be established |

After local authentication, use the verified read-only command:

```sh
npx --yes supabase whoami
npx --yes supabase backups list --project-ref dhuikxkrokowvnvzpihp
```

If needed, authenticate locally with `npx --yes supabase login`; do not paste access
tokens/passwords into chat. The CLI's backup commands list/restore existing physical
backups; they do not create an on-demand physical backup. Establish project-specific
backup/PITR status in the dashboard before deciding how to create additional recovery
coverage. No paid add-on or password reset is authorized by this report.

Supabase documents daily backups for paid plans and CLI exports for free-tier
projects. Restore from the verified dashboard backup or PITR point only under a
separately approved recovery operation; restoration incurs downtime. Daily restore
can lose writes after the selected backup; PITR is bounded by its actual available
WAL recovery range. Database backups exclude uploaded Storage object bytes, and
custom-role password recovery may need separate handling. See
[Supabase backup/recovery documentation](https://supabase.com/docs/guides/platform/backups).

A manual logical backup should cover roles, application public/private schema and
data, Auth, relevant Storage metadata and migration history, with Storage files and
deployment configuration protected separately. Use a supported snapshot-consistent
procedure, encrypted access-controlled storage outside the repository, checksums
and a disposable restore rehearsal. CLI dump requires a working database connection
and Docker; neither Docker nor a verified database connection is available here.
Do not export sensitive production rows through ad hoc MCP queries as a substitute.

Until recovery evidence is available, execution stops at this preflight report.
The static reviews below are preparation, not authorization to bypass this gate.

## Before-migration verification record

Aggregate snapshot: **2026-10-01 04:13:15 UTC**. Production can change after this
observation; repeat immediately before an approved maintenance window.

| Table | Rows |
| --- | ---: |
| organizations | 1 |
| organization_memberships | 1 |
| teams | 1 |
| ticket_categories | 11 |
| ticket_subcategories | 0 |
| assets | 77 |
| audit_events | 118 |
| tickets | 0 |
| ticket_messages | 0 |
| ticket_activity | 0 |
| notifications | 0 |
| private.notification_email_outbox | 0 |

No ticket description, message body, personal profile value, credential or secret
was retrieved. Null message authors and incompatible audit-action values both count
zero. The existing audit-action CHECK allows created/updated/deleted. The
automation enum value, ticket revision, message authorship fields, Automation
tables, outbox tables and Automation functions are absent. No partial Automation
installation or object-name collision was observed.

Schema comparison against an isolated replay of the first 26 migrations:
241 columns, 149 constraints, 122 indexes, 47 triggers, 91 policies, 65 application
functions, 8 enums, 30 tables, 240 table privileges, 112 column privileges and 63
function privileges: **1,168 matching fingerprints, zero missing, changed or extra**.
Fingerprint groups are preserved in the JSON manifest; the reusable
[schema query](automation-preflight-schema.sql) reads metadata only.

PostgreSQL 18 adds named NOT NULL rows to `pg_constraint`; the comparator excludes
that engine-specific representation and checks column nullability on both engines.
See [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html).
Scope excludes platform-owned Auth/Storage internals, extension-owned functions,
ownership, schema/default ACLs, role attributes, sequences' current values and
deployment settings. This is not a complete `pg_dump` drift comparison or restore
test. No drift was found within the inspected application scope.

## Migration-by-migration review

Lock descriptions below are static worst-case expectations, not measured production
timings. DDL locks last to transaction commit. Most ALTER TABLE forms require
ACCESS EXCLUSIVE; ADD FOREIGN KEY requires SHARE ROW EXCLUSIVE on both participating
tables. Use a quiet window and bounded lock waits. See
[PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html).

**1 — Rule definitions (`20261001014435`).** Creates public `automation_rules` and
`automation_rule_versions`, indexes, tenant/membership foreign keys and canonical
definition CHECK. Adds the trusted catalog, structured validators, reference adapter,
`manage_automation_rule`, and public create/update/duplicate/enable/archive RPCs.
Enables RLS with administrator SELECT policies plus restrictive MFA; revokes direct
writes including service role; grants only authorized management RPCs. Adds immutable
version/no-hard-delete triggers. No old application rows are updated or backfilled;
rules start empty/disabled. New-object/catalog locks plus FK locks on organizations
and memberships; no old ticket scan. Failed transaction rolls back; after use retain
versions/audit history and prefer a forward correction. No enum change or data deletion.

**2 — Administration audit (`20261001014436`).** Replaces the existing
`audit_events_action_check` with a superset including enabled/disabled. Creates
`record_automation_administration_audit` and the rule audit trigger; direct execution
is revoked. Existing audit rows are checked, not rewritten; current 118 rows satisfy
the new constraint. ACCESS EXCLUSIVE on audit_events can block normal ticket/admin
audit writes while validation runs. Existing audit RLS/append-only behavior stays
intact. No enum/backfill/data deletion. Do not restore the narrower CHECK after new
enabled/disabled entries exist; use a forward fix or approved recovery.

**3 — Durable events (`20261001020338`).** Creates private `domain_events` and
`domain_event_deliveries`, constraints/indexes, immutable-event trigger and RLS with
no client policies/direct grants. Adds publisher/envelope/cause/snapshot functions,
server-owned ticket `revision` default 1, revision/capture triggers and service-only
claim/finish wrappers. Existing tickets get the default revision without fabricating
historical events; none exist at snapshot time. ALTER tickets needs ACCESS EXCLUSIVE;
FKs and trigger installation also take locks. No existing routing/SLA/activity/
notification trigger is removed. New legitimate writes start capturing events even
while processing is OFF. No enum change or destructive DML. Do not drop events or
revision to roll back a deployed application; recover/forward-fix deliberately.

**4 — Execution authority (`20261001022623`).** Creates public executions/steps;
private processing state, version visibility, chains, chain claims and command
contexts; indexes, composite FKs, uniqueness and state checks. Adds event capture
transaction/snapshot columns, visibility backfill from rule versions, visibility
triggers, SQL comparison/compatibility helpers and service-only begin-execution RPC.
Admin+MFA SELECT only on public history; no direct client runtime access. The singleton
insert uses `singleton=true` while **active defaults false**, generation 0; it does
not activate processing. Domain-event ALTERs/FK validation acquire locks and populate
new metadata on any intervening events; volatile defaults may require table work.
Version backfill is empty for this upgrade unless somebody creates a rule between
migrations. No old ticket/SLA/body update, enum change or historical replay. Retain
receipts/history on recovery; do not delete chain records to force execution.

**5 — Trusted commands (`20261001023010`).** Creates current-command authority,
note guard, provenance stamping and the trusted step RPC; replaces
`restrict_employee_ticket_update` with the explicit service-execution check while
retaining employee reopening restrictions. Alters ticket_messages: author_id becomes
nullable only under constrained authorship; adds default member author_type and
execution/step/name provenance, CHECK/FK/unique constraints and index. Existing human
messages keep their author IDs and gain member classification, with no body rewrite.
Revokes client provenance-column writes; RPC execute is service-only; normal RLS
remains. Adds note, event, activity and audit provenance triggers. ACCESS EXCLUSIVE
on ticket_messages plus constraint/index scans and trigger locks on activity/audit/
events; currently no messages. No enum or migration-time delete. Existing external
service-role direct ticket/message writers, if any outside this repository, will
need validated authority; no such bypass is approved. Once system notes exist,
blindly restoring author_id NOT NULL would fail and discard provenance semantics.

**6 — Notification enum (`20261001025400`).** Adds `automation_update` to existing
notification_kind; type/catalog locking only, no notification row mutation, backfill,
RLS/grant or trigger changes. **Commit separately before migration 8 uses the value.**
There is no simple safe DROP VALUE rollback after commit; leaving an unused enum
label is preferable to rebuilding a live type ad hoc.

**7 — Delivery orchestration support (`20261001025401`).** Replaces error-code CHECKs
on executions/steps/deliveries; adds close/terminalization, eligibility, fenced-lease,
claim/discover/read functions, public service-only wrappers and a terminal-delivery
trigger. Replaces finish RPC implementation while preserving its signature and
existing grants. Its upgrade DO block closes orphan running executions attached to
dead/acknowledged deliveries; completed receipts remain, remaining steps terminate
safely. There are no existing executions in this production baseline, so that repair
has no rows to change. ACCESS EXCLUSIVE for CHECK changes and row locks for repair
if applicable; no existing ticket data update. No new activation or enum change.
Do not reverse finalized history during rollback; prefer forward repair.

**8 — Notification command (`20261001025402`).** Adds private notification enqueue
adapter and replaces the trusted step implementation, adding the bounded recipient
contract and transient-error propagation. Reuses existing notification/inbox/outbox
functions; enqueues nothing during migration. Catalog function locks; no existing
notification/ticket backfill, RLS change, table alteration, enum addition or new
public RPC signature. Direct adapter execution is revoked; prior command grants
remain. Recovery cannot retract already delivered emails once activation occurs;
keep database receipts and address dispatch separately.

**9 — Dry-run reads (`20261001031036`).** Creates read-only reference validation and
private/public dry-run functions, fixed search paths, active admin/MFA authorization
and same-tenant source checks. Revokes defaults and grants only authenticated read
entry points; service/anonymous direct invocation remains denied. No table/policy/
trigger/enum modification or backfill; function/catalog locks only. No draft is saved
and no executor is called. Revert only with a compatible app or a forward read fix.

**10 — Administration reads (`20261001032617`).** Adds private/public STABLE bounded
admin-read RPC (list/choices/events), explicit admin/MFA/tenant checks and authenticated
execute grants after revocations. Does not grant direct event access. No table,
existing policy, trigger, enum, backfill or data mutation; catalog locks only. Removing
this RPC while Stage 7 remains deployed would break its list/reference/event reads.

No pending migration drops an application table/column, truncates data, rewrites
ticket bodies or deletes old records at migration time. Constraint replacements,
function replacements, author nullability and additive triggers are material
behavior changes despite processing OFF. The migrations target the existing schema;
they do not require a clean database. An isolated 26→36 replay passed and returned
`active=false,generation=0` on PGlite PG18.3. That is not a Supabase PG17 replay.

## Recommended operation after blockers and explicit approval

1. Establish and document a recoverable backup point and tested restore procedure.
   Resolve CLI authentication locally; verify the project ref again before writes.
2. Agree and approve the two-file history reconciliation; verify every environment
   before changing filenames. Never replay the already-applied routing SQL or repair
   production history merely to silence the CLI.
3. Repeat remote ledger, fingerprints, aggregate counts and OFF checks immediately
   before a quiet maintenance window. Pin this manifest's SHA-256 values. Account
   for concurrent application writes and the existing notification SLA cron.
4. Once histories genuinely align, inspect the runner's supported dry-run options
   and require exactly the ten Automation files. Use one transaction per migration,
   stopping at the first error. Commit the enum file separately. Select an approved
   lock timeout (suggest 5 seconds) and statement timeout appropriate to current
   sizes; abort rather than wait indefinitely or terminate unrelated sessions.
5. Recheck identity on every migration call. Use the runner's normal atomic schema+
   ledger recording; never mark a failed migration applied. If a response is lost,
   read back ledger/schema before retrying. Do not automatically rerun non-idempotent
   CREATEs/enum additions. No blanket reset, fixture seed, branch merge or history repair.
6. Read back all 36 entries and OFF state. Keep deployment processing OFF and stop
   for the post-migration report. This step authorizes no worker test or activation.

## Post-migration verification proposal

- Compare pinned file hashes and ledger; repeat safe aggregates. Investigate count
  differences against legitimate concurrent activity rather than assuming deletion.
  Audit actions/rows remain intact; assets, memberships, categories and routing persist.
- Verify revision exists/defaults 1 and message author_type defaults member with
  authorship/FK protections. Confirm SLA columns/functions, category routing, timestamp
  preparation, employee restrictions and existing notification/audit triggers remain.
- Verify processing singleton `active=false`, `generation=0`, `activated_at=null`.
  No rules should have been seeded; no executions/steps should have appeared. Events
  may accumulate from ordinary ticket writes while OFF; this is expected capture.
- Check new admin+MFA RLS, RPC signatures, client write revocations, private runtime
  denial and service-only command grants; refresh/verify PostgREST schema visibility.
  Run Supabase security advisors and classify pre-existing versus new notices.
- Smoke-test Vercel Administration list/new/edit/history reads, disabled rule CRUD,
  exact-version history and zero-side-effect dry run with legitimate admin/MFA
  sessions and an approved synthetic ticket. Verify technician/end-user denial and
  unauthorized cron 401; authorized OFF response must do no privileged work.
- Verify existing ticket creation/update/reopening, routing, SLA, conversation and
  notifications using explicitly approved synthetic data; normal actions can send
  notifications even when Automation is OFF. Do not use real customers as fixtures.
- Keep hosted tenant isolation/concurrency/worker/failure/kill-switch/observability
  as separate controlled checks. Tests requiring global database activation cannot
  run under this preparation authorization. Require explicit scoped approval and
  complete enabled-rule inventory before any future activation.

No application code or migration file changed in this preflight. New files are this
report, the safe JSON evidence manifest and read-only schema fingerprint query.
The general [rollout runbook](automation-rollout.md) remains the operational guide;
this report supersedes its earlier assumption that counts alone implied an aligned
26-migration history.
