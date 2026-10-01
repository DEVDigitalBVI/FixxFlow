# Automation rollout runbook — Stage 8

The subsequent [production alignment preflight](automation-production-preflight.md)
verified matching SQL bodies and reconciled two repository filenames to the existing
production identifiers with explicit approval. All 26 applied IDs now align, and an
approved CLI dry run proposes exactly ten Automation migrations. No real push or
production history repair occurred. The required fresh logical backup remains
blocked by the missing Docker/Podman dump runtime.

Status: **deployment preparation; activation blocked**. No production migration,
deployment or activation has been performed during this stage. The current approval
covers repository identifier reconciliation, checks, push dry run and logical backup
only. It explicitly excludes a real production push. Complete the fresh backup and
obtain new migration approval before applying migrations. Processing remains OFF.

## Baseline and evidence (2026-10-01)

Baseline commit: `d9104ad4791521d640e0f24af6d23afdcd946211` (`Automation Stage 7`),
branch `main`, initially clean working tree. Repository: 36 SQL migrations; latest
`20261001032617_automation_admin_reads.sql`. The extra tracked migration-directory
entry is not a SQL migration.

Baseline Node 26.8.2: 512 tests passed, none failed/skipped; typecheck, zero-warning
ESLint and production build passed. Final verification after the observability fix
and two rollout regression scenarios: **514 tests passed under Node 24.21.0 and
Node 26.8.2**, none failed/skipped. Node 24 typecheck, zero-warning ESLint and
production build passed. All Stage 1–7, security, ticket, routing, SLA, reopening,
conversation, audit, notification and dry-run regressions are included.

Node 24 was downloaded from the official Node distribution and SHA-256 verified:
`bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`
for `node-v24.21.0-darwin-arm64.tar.gz`. `npm ci --no-audit --no-fund` installed 375
lockfile-pinned packages; no dependency or lockfile change. Installation reported
the existing ESLint deprecation and npm's unapproved `unrs-resolver` postinstall
warning; subsequent lint/build passed. No dependency upgrade was attempted.
Both runtimes report Unicode 17.0 / ICU 78.3. The exhaustive lowercase mapping,
stored SQL mapping, dotted-I/contextual-sigma and condition parity tests pass on
both. This closes the Node/Unicode development gates for this tested Node 24 patch.
Use Node 24 in deployment and rerun parity when changing runtime/ICU versions.

Local logs are in `/tmp/stage8-*` (ephemeral, not a release artifact store):
baseline tests/lint/build, Node 24 install/tests/typecheck/lint/build, final Node
24/26 tests, worker tests and final typecheck/lint. Preserve release CI evidence
in the deployment record before rollout.

| Gate | Status | Evidence / remaining requirement |
| --- | --- | --- |
| Node 24 | PASS | 24.21.0 install, 514 tests, typecheck, lint and build |
| Node 24 Unicode parity | PASS | Same mappings/comparison outcomes as Node 26; SQL comparator parity passes |
| Supabase PostgreSQL 17 | BLOCKED | Main project reports PG 17.6; no authorized disposable hosted target. No clean/upgrade replay on PG17 |
| PostgREST | BLOCKED | No real authenticated Automation HTTP/RLS exercise; SQL adapter is not HTTP evidence |
| Independent concurrency | BLOCKED | No two independent live database sessions tested |
| Tenant isolation | BLOCKED | Two-tenant embedded regressions pass; hosted JWT/PostgREST checks outstanding |
| Worker end-to-end | BLOCKED | Embedded assignment/priority and internal-note canary pass; hosted path outstanding |
| Failure recovery | BLOCKED | Embedded stale/reference/failure/retry/exhaustion/chain regressions pass; hosted recovery and UI inspection outstanding |
| Kill switch | BLOCKED | Embedded pending-work/history/reactivation test passes; hosted in-flight and deployed UI checks outstanding |
| Observability | BLOCKED | Step identifiers added; safe structured-log assertions pass. Deployed log ingestion/trace inspection outstanding |
| Production build | PASS | Local optimized build on declared Node 24; not a claim of a production deployment |

No failing automation semantic test was found. BLOCKED gates cannot be promoted to
PASS using PGlite PostgreSQL 18.3, sequential savepoints, fabricated JWT claims or
component harnesses. Live keyboard/mobile/UI state inspection is also still open.

## Targets, access and processing controls

- Supabase main: `dhuikxkrokowvnvzpihp` (FixxFlow), PostgreSQL 17.6. Read-only
  inspection found 26 applied migrations, latest `20260927233229`; no
  `private.automation_processing_state` table. No development branches exist.
- Vercel linked project: `fixx-flow`, ID `prj_cRiVEa8CAAtKHxMQoNvf3pEo7RRo`, team
  `team_PxGCCYQl1LuB0sFn0CPFwBz1`. CLI authentication verified. Use the explicit
  linked team scope; unscoped name lookup can fail.
- An existing READY production deployment was observed:
  `dpl_7hpyWbhf6hrrQg86RmUQ2m9tBLFs`,
  `fixx-flow-cssfwhlwu-fixx-flow.vercel.app`. It was not created by this work.
  Deployment-list metadata confirms commit `d9104ad` (Automation Stage 7). The
  previous observed production deployment is Stage 6 (`e9676b5`), so neither is
  established as a compatible pre-automation rollback candidate.
- **Existing deployment/schema mismatch:** Stage 7 is already deployed while its
  ten database migrations are absent. Automation routes and newer conversation
  reads may fail on missing tables/columns, even with processing OFF. No live
  authenticated smoke test has measured the impact. Establish backup readiness,
  then apply the authorized pending schema migration sequence with processing OFF;
  do not assume another application deployment fixes this mismatch.
- Production environment metadata was read without exposing secret values.
  `AUTOMATION_PROCESSING_ENABLED` is absent, so the new code defaults OFF.
  `CRON_SECRET`, server Supabase credentials and public Supabase configuration
  entries exist; their correctness has not been established by a deployment smoke test.
- Local `.env.local`: automation flag absent, OFF by default. `.env.example` is
  explicitly false. No environment or production configuration was changed.
- CLI authentication now succeeds. Backup inventory verifies seven completed daily
  physical backups, latest listed 2026-09-30T11:40:54.767Z; PITR is disabled. The fresh
  logical backup attempt failed because Docker/Podman is unavailable. Native
  `pg_dump`/`psql` are also unavailable; no usable logical artifact was produced.

Two independent gates must be ON to process:

1. Server environment `AUTOMATION_PROCESSING_ENABLED=true`; every other/missing
   value is OFF before a privileged client is constructed.
2. Owner-controlled database `private.automation_processing_state.active`, changed
   only through `private.set_automation_processing(boolean)`. Migration default is
   false. Normal clients and service-role RPC callers cannot activate it.

After migration, owner-only readback:

```sql
select active, activated_at, generation
from private.automation_processing_state;
```

Emergency stop (authorized database owner):

```sql
select private.set_automation_processing(false);
```

Then set the deployment environment flag to false and redeploy. A database stop
fences subsequent commands; it waits for existing conflicting transaction locks
and does not undo an already committed action. An environment-only stop prevents
new invocations and does not interrupt an invocation already running. Neither
control deletes rules, receipts, events, deliveries or history.

An environment-only pause preserves the database epoch and eligible pending work
may resume. A database false→true transition creates a new cutoff/generation.
New executions require an event strictly newer than activation, rule enablement
and pinned-version creation, with activation/version transactions visible to the
event capture snapshot. Old pending events stay ineligible; older-generation
executions cannot continue. Do not change timestamps or replay old events to work
around this policy.

## Backup and recovery readiness — required before migration

Supabase CLI authentication is verified. Never paste access tokens or database
passwords into chat, source code or the runbook.
Verified CLI discovery commands:

```sh
npx --yes supabase backups list --project-ref dhuikxkrokowvnvzpihp
```

This lists available physical backups; it does **not** create a backup. The current
CLI exposes list/restore operations, not an on-demand physical-backup creation
command. Check the project's Database Backups page for a successful recovery point
and PITR availability. Do not enable a billed backup/PITR plan without approving
its cost. Do not run restore against production as a verification step.

The current checkpoint requires a fresh logical backup in addition to the verified
daily platform point. Use the supported Supabase CLI logical backup procedure with
a secure session/direct connection and a working Docker/Podman runtime:
export roles, schema and data to access-controlled encrypted storage outside the
repository; include application `public`/`private`, Auth, relevant Storage metadata
and migration history. Check the tool's current default exclusions. Preserve
Storage object bytes/configuration separately, since a database backup alone does
not copy uploaded files. Never substitute an MCP JSON table export for a backup.

Record UTC backup timestamp, project/ref, engine version, retention, protected
artifact location/checksum (for logical dumps), recovery owner, RPO/RTO and a
successful disposable restore test. Confirm consistency if writes continue during
separate logical exports; use a supported snapshot-consistent method or maintenance
window. The recovery point must precede the first migration and remain available
through rollout. Do not reset production passwords to obtain access without an
explicit credential-rotation plan.

References: [Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[isolated data-less branches](https://supabase.com/docs/guides/deployment/branching).

## Non-production verification protocol

Provision an explicitly approved disposable Supabase PG17 project/branch, separate
API credentials, two synthetic organizations and synthetic users. Confirm project
ref at every mutation; never point fixtures at main. Disable outbound email/provider
credentials there. A branch is a separate billed resource; obtain organization and
cost approval before creating one. Branches inherit schema without production data.

1. **Clean install:** replay all 36 migrations against fresh Supabase-managed
   schemas; commit each migration separately (the notification enum addition must
   commit before its use). Preserve migration logs and inspect grants/RLS/advisors.
   Do not use the test bootstrap stubs in a real Supabase instance.
2. **Upgrade:** establish the first 26 migrations through `20260927233229` with
   representative synthetic tickets/messages/routing/SLA data, then apply the ten
   pending migrations below. Verify original data, tenant keys, histories and OFF
   state. Also reproduce the Stage 4→5 exhausted-execution repair fixture.
3. **PostgREST:** authenticate real administrator, technician and end-user sessions
   in both tenants; test actual MFA enforcement with legitimate AAL1/AAL2 sessions.
   Exercise the existing Supabase repositories, including `.single()` RPC result
   shapes. Cover create/update/stale expected-version conflict/enable/disable/
   duplicate/archive, rule/version reads, `read_automation_dry_run`,
   `read_automation_admin` list/choices/events, execution/step reads. Validate draft
   and persisted dry-run results through the server service, not only its read RPC.
4. **Isolation:** attempt other-tenant rule/version/event/execution/step/ticket and
   technician/team/category/recipient IDs. Test forged organization IDs, direct
   writes, RPC invocation as technician/end user/insufficient MFA/service where
   forbidden. Record HTTP status and safe error code, never JWTs or response bodies
   containing private ticket data. Empty RLS results also count as denial where
   that is the established contract.
5. **Real concurrency:** use two independent direct/session-pooler connections,
   record distinct `pg_backend_pid()` values, explicit transaction barriers and
   lock-wait observation. Do not equate Promise concurrency on one connection with
   a race. Hold A's update uncommitted; B edits with the same expected version;
   commit A and require B's conflict with exactly one new immutable revision.
   Hold enablement uncommitted while B captures an event; later commit must not
   make that previously invisible version eligible.
6. Race two service claims and prove disjoint leases. Race two commands for the
   same persisted step and prove one side effect and one successful receipt (the
   second may return that receipt). Repeat for notification enqueue per recipient.
   Hold an old command/claim around real lease expiration and reclaim; verify
   rotated tokens reject old callers after lock acquisition. Use independent worker
   invocations, bounded waits, and actual committed transactions.
7. **Canary:** only in this test environment, enable both controls and a dedicated
   `ticket.created` rule with Priority=Low, unique verification subject and internal
   note “Automation verification successful.” Create a new matching ticket after
   activation. Trace event→delivery→rule/version→conditions→execution→note/step→
   history; verify automation authorship, correlation/causation and no duplicate.
   Create a nonmatching ticket and verify skipped history/zero actions.
8. **Failures:** invalidate a reference after configuration, make a ticket stale,
   cause an action failure, interrupt a worker after a committed receipt, let its
   lease expire, reclaim/retry, exhaust eight attempts and exercise depth <8,
   32 executions/100 attempts limits. Preserve completed receipts and unexecuted
   remainder. Confirm UI distinctions, especially Retry exhausted versus Action
   failed, pinned historical versions and safe error text.
9. **Kill switch:** retain completed history and eligible pending work, stop the
   database gate then deployment gate, and prove zero new actions and unchanged
   data/history. Confirm Administration remains available. Reactivate in isolation
   and verify the new cutoff rejects old pending events; create a fresh canary for
   recovery. Finish with both controls OFF.
10. **Logs/UI:** inspect actual deployed logs for the allowlist below, validate cron
    unauthorized 401 and authorized OFF response, then check keyboard/mobile,
    dry-run “No changes were made,” simulation/history warnings and all failure
    presentations in a browser. Save redacted evidence.

Review the exact hosted PG17 minor version too. The September 25 Supabase changelog
announces PG17.11 changes for certain extensions/custom operators; repository search
found no ltree/btree_gist/legacy PGP/custom-operator usage. That static result does
not establish the hosted database has no out-of-repository objects. See the
[official PG17 compatibility advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## Production deployment sequence (processing OFF)

Do not push `main` or promote a deployment before database prerequisites: the Git
integration may deploy automatically. Record the exact release commit and current
Vercel production deployment ID for rollback.

1. Confirm recoverable backup and authorized maintenance window. Review all gate
   evidence; retain outstanding activation blockers explicitly.
2. Verify the production project/ref and applied migration ledger immediately
   before deployment. Apply only pending immutable files, in order, one migration
   transaction at a time; stop on the first error. No schema reset, fixture seed,
   branch merge or automatic history repair against production.

   Pending after observed `20260927233229`:
   - `20261001014435_automation_rule_definitions.sql`
   - `20261001014436_automation_administration_audit.sql`
   - `20261001020338_durable_domain_events.sql`
   - `20261001022623_automation_execution_authority.sql`
   - `20261001023010_automation_ticket_commands.sql`
   - `20261001025400_automation_notification_kind.sql`
   - `20261001025401_automation_worker_delivery.sql`
   - `20261001025402_automation_notification_command.sql`
   - `20261001031036_automation_dry_run_reads.sql`
   - `20261001032617_automation_admin_reads.sql`

3. Read back 36 applied migrations and database `active=false`. Even with processing
   OFF, event capture triggers are live after migration; smoke-test existing ticket
   creation/update, routing, SLA, employee reopening, history and notifications.
   Watch transaction latency and outbox growth. OFF is not a schema compatibility test.
4. Deploy the application to Vercel on Node 24, explicitly setting server-only
   `AUTOMATION_PROCESSING_ENABLED=false`. Required environment: public Supabase URL
   and publishable key, public site URL, server-only `SUPABASE_SECRET_KEY` and
   `CRON_SECRET`. Existing email sender/provider settings remain with the separate
   notification dispatcher; the Automation worker does not need email credentials.
5. Confirm `/api/cron/automation` every minute in `vercel.json`, 60-second route
   maximum and 45-second work budget. Verify platform plan supports this schedule.
   Wrong/missing bearer secret must yield 401; authorized OFF yields disabled=true
   and no privileged work. Do not log or paste the bearer secret.
6. Smoke-test authenticated Administration list/new/edit/history/detail, tenant/MFA
   denial, disabled rule CRUD/duplicate/archive, optimistic conflict and unsaved
   dry run. Confirm no dry-run row changes and “No changes were made.” Confirm both
   processing controls remain OFF and existing FixxFlow operations work.
7. Stop. Record deployment ID, migration ledger, gates, backup, test evidence and
   rollback owner. Production activation requires separate explicit approval.

## Controlled activation proposal — not executed

Only after every activation gate passes and explicit approval: review all enabled
rules across tenants (activation is global, not tenant-specific). Disable unrelated
rules through authorized management paths. Create one disabled internal-note rule
for a dedicated test organization, exact unique subject and Low priority. Dry run,
then enable that rule. Enable the deployment flag with database still OFF; activate
the database gate last. Create a new narrowly scoped test ticket after activation.

Verify exactly one expected immutable version/target, conditions, note provenance,
step receipt, ticket and execution history, identifiers in logs, no duplicates and
no unexpected sibling rule. Observe at least two cron cycles. Stop on any anomaly.
Expand one rule/tenant at a time only after review. Initial activation excludes
assignment/status/priority mutations and broad notification actions. No replay.

## Diagnosis and rollback

Application logs allow only component/result/safe error code, organization,
delivery/event/type/correlation, rule/version, execution and action step/id/position.
Stage 8 fixes missing step identifiers. Tests reject definition, lease token,
description/body and synthetic secret leakage. Do not add raw SQL/provider errors,
complete rule JSON, ticket descriptions, message bodies, credentials or tokens.

Start with the administrator execution-detail page and safe error code. Match
execution→delivery/event→correlation in server logs. Inspect pinned version and
ordered steps, receipt status, ticket revision, rule availability and processing
epoch. Use restricted owner reads for delivery attempts/status/lease expiry; never
copy lease tokens or full event snapshots into incident notes. An absent execution
can mean backlog ineligibility/disabled rule, not a broken worker. A skipped execution
means conditions did not match. `stale_entity` requires new state/event; do not
rewrite its revision. `retry_exhausted` closes unfinished executions after bounded
delivery retries; it is distinct from a committed `action_failed` step. Check
connection/lease health for transient failures and retain receipts. Inspect inbox/
email-outbox status separately for email issues; database enqueue idempotency does
not guarantee exactly-once external delivery.

For an incident, stop database processing, then the environment gate. Record the
time, generation, affected IDs and completed receipts. Redeploy the last compatible
application version with OFF retained. Prefer a reviewed forward database fix;
never drop runtime/history tables or reverse additive migrations ad hoc. Restoring
a database backup is a separate authorized incident operation with downtime/data-loss
impact: reconcile writes after the recovery point and preserve incident evidence.
Database restoration alone cannot retract an email already sent. Resume only after
root cause and gate re-verification; a new activation cutoff is intentional.

## Stage 8 changes

- `src/features/automation/worker.ts`: add allowlisted step ID/action ID/position to
  action-result logs; no execution/authorization/planner/retry contract change.
- `src/features/automation/worker.test.mjs`: verify those identifiers and add the
  low-priority internal-note canary plus pending-work kill-switch/reactivation test.
- This runbook. No migrations, schema changes, UI changes or feature expansion.

Remaining release risks: existing production application/schema mismatch,
unavailable pre-migration backup, unverified hosted gates,
no disposable target, live browser inspection outstanding, and production runtime/
cron/secret correctness still requiring smoke tests. Processing stays OFF.
