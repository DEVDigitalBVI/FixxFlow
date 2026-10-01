# Automation worker — Stage 5

Stage 5 adds server orchestration and the existing notification action. Processing
remains **OFF** by default. No production database was migrated or activated.
Stage 6 dry runs, administration UI, historical replay and external integration
actions are not included.

## Files and migrations

Apply these migrations in order, with the enum migration committed separately:

- `20261001025400_automation_notification_kind.sql`: adds `automation_update` to
  the existing notification kind enum.
- `20261001025401_automation_worker_delivery.sql`: eligible claims, paginated
  discovery, fenced execution reads, delivery terminalization and upgrade repair.
- `20261001025402_automation_notification_command.sql`: notification enqueue through
  the existing trusted step command, plus propagation of transient SQL failures.

No tables or RLS policies are replaced. Existing execution/delivery error-code
constraints are extended. New public RPCs are `claim_automation_events`,
`discover_automation_rules`, and `get_automation_execution`; they delegate to
private functions with fixed empty search paths and service-only execution grants.
The existing `finish_domain_event_delivery` and `execute_automation_ticket_step`
signatures are unchanged. Internal lease, eligibility, terminalization and
notification helpers have no direct client grants.

New application files:

- `src/features/automation/worker.ts`: orchestration and allowlisted log records.
- `src/features/automation/worker-repository.ts`: server-only RPC adapter.
- `src/features/automation/worker-failures.ts`: centralized failure classification.
- `src/types/automation-worker-database.ts`: typed RPC contracts.
- `src/app/api/cron/automation/route.ts`: authenticated cron entry point.
- `src/features/automation/worker.test.mjs` and
  `tests/helpers/automation-worker.mjs`: real migrated database integration,
  simulated RPC boundaries, upgrade, recovery and endpoint tests.

Modified files:

- `.env.example` and `vercel.json`.
- `src/types/database.ts` and `src/types/automation-execution-database.ts`.
- `src/lib/events/delivery.ts`.
- `src/features/automation/execution-records.ts`.
- `src/features/notifications/presentation.ts`.
- `src/features/automation/execution-database.test.mjs`.

The Stage 4 test now expects the approved notification action to succeed and
ensures distinct fixture timestamps for the strict activation cutoff. No UI
controls or layouts were added. This document is the remaining new file.

## Processing and ordering

Each invocation claims up to five deliveries with 120-second leases. A 45-second
orchestration budget leaves time within the route's 60-second maximum to release
work through the existing retry protocol. Expired tokens cannot authorize commands.
There is no in-memory lock or application-level ticket mutation.

Discovery derives tenant and event from the persisted, locked delivery. Rules are
ordered by **creation timestamp ascending, then rule UUID ascending**, with
50-row keyset pages preserving the database's timestamp precision. Actions use
their validated configured positions. Retries traverse the same order; execution
uniqueness and successful receipts recover work without repeating effects.

The worker validates the event and pinned rule using Stage 1 contracts, then calls
the existing pure planner. Database admission independently verifies authority and
condition outcomes. The worker compares those outcomes structurally and fails
closed on disagreement. A nonmatch persists `skipped` execution history and
`not_attempted` steps. Invalid structure never reaches action dispatch.

New executions must satisfy the unchanged Stage 4 backlog predicate:

`event.occurred_at > greatest(processing.activated_at, rule.enabled_at, version.created_at)`

The rule must also be enabled, unarchived, in the event organization and match its
trigger. Both the activation transaction and revision transaction must have been
visible to event capture, subject to the existing same-transaction exception and
strict timestamp check. Historical or otherwise ineligible events are not claimed
for new executions. They remain infrastructure records; no replay is introduced.
Editing a rule does not apply its new version to old queued events.

Recovery includes previously admitted executions and their original immutable
versions, including when the rule subsequently changes. Commands still enforce
current enablement/version, processing generation and revision. An edit, archive,
disable or processing reactivation cannot authorize continuation of obsolete work.

Strict revision protection also applies between different rules for one event.
If an earlier rule changes the ticket revision, a later rule's mutation fails
`stale_entity`; it is not silently rebased. Nonmutating notes and notifications
also retain the conservative revision check. Chain depth must remain below 8,
with at most 32 executions and 100 action attempts per organization/correlation.
These limits include nonmatching execution admissions and remain database enforced.

## Retries, crashes and terminal delivery history

`worker-failures.ts` is the sole application retry classifier. Known transport,
temporary connection/availability, serialization, deadlock, lock-timeout and
statement-timeout failures may retry. Local lease/budget exhaustion also defers
through the retry protocol. Validation, authorization, invalid configuration,
tenant mismatch, invalid storage and chain-limit errors are terminal. Unknown
programming errors fail closed; raw error-message text is never classified/logged.

The command RPC propagates serialization/deadlock/lock-unavailable exceptions so
the entire attempted command rolls back, including counters and receipts. It does
not turn a temporary database failure into a committed failed action. Persisted
action failures remain final: completed steps are preserved and later actions
become `not_attempted`. There is no continue-on-error policy or retry of a committed
failed step. A failed rule does not prevent separately eligible rules being
considered, subject to chain limits and revision protection.

Delivery backoff remains `min(3600, 30 * 2^(attempts - 1))` seconds, with eight
claims maximum. A final retry acknowledgement, or reclamation of an expired eighth
lease, makes the delivery `dead` with `retry_exhausted`. The same transaction closes
associated running executions as `failed` or `partially_completed`, preserves
successful receipts, marks pending steps `not_attempted`, and records the distinct
safe exhaustion reason. Other terminal delivery errors close unfinished execution
history with `delivery_failed`. An acknowledgement with unfinished execution work
is rejected. The upgrade repairs already-terminal deliveries with running history;
it does not replay their completed actions.

If acknowledgement is unavailable or the token is lost, the invocation records
deferred work and leaves recovery to lease expiry. Claim uses row locks and
`SKIP LOCKED`; command/finish operations validate the rotated token after blocking
locks. A lost response after commit returns the existing successful receipt on
retry. Ticket effects, note insertion or notification enqueue and the receipt
commit atomically. Reaping expired work resumes when processing is enabled again;
there is no separate background reaper while both worker controls are off.

## Notifications and security

`send_notification` runs inside the Stage 4 command authority, using only its
persisted pinned action. It supports the established `ticket_update` template and
`requester` or `assigned_technician` recipients. The helper derives the recipient
from the same-tenant ticket and locks/revalidates active membership and the
existing ticket-access rules. Arbitrary recipient IDs, bodies and organization
IDs cannot confer authority. An unavailable recipient fails the action safely.

The helper calls existing `private.enqueue_notification`; it uses the existing
inbox, preferences, email outbox and separate notification dispatcher. The fixed
heading is `Ticket #<number> update`, with no ticket description or note content.
The event key combines execution, step and recipient identity, providing
database-side enqueue idempotency. The step records the notification ID receipt.
External email delivery is not claimed to be exactly once. Missing email-provider
credentials do not affect the automation worker; email remains subject to the
existing dispatcher's configuration, retry and expiry behavior.

Assignment/status notifications continue through existing ticket triggers. The
worker does not enqueue duplicates of those natural notifications. The explicit
notification action is a separate intentional notification.

All direct runtime table writes remain prohibited. Existing administrator/MFA
history policies and tenant composite keys are unchanged. Service credentials
alone do not authorize ticket or notification effects: persisted execution,
action, lease, current references, revision, chain limits and transaction authority
are independently checked by the database. No credentials enter browser modules.

## Deployment controls and operations

There are two independent controls:

1. Server environment `AUTOMATION_PROCESSING_ENABLED=true` permits cron invocation.
   Missing or any other value is OFF, without constructing a privileged client.
2. Owner-only `private.set_automation_processing(boolean)` controls database
   admission and commands. A false-to-true transition advances the cutoff and
   generation. Service-role and normal clients cannot call it.

Deploy migrations and code with both controls OFF. Before activation, complete the
environment verification gates below. Configure `CRON_SECRET` and the existing
server-side Supabase credentials. When operationally approved, enable the
deployment flag while the database gate is still OFF, then activate through the
owner-only database function. Only events eligible after that activation can
start new executions. Neither migrations nor the worker activate processing.

For an immediate processing stop, the database owner can run:

```sql
select private.set_automation_processing(false);
```

Then set the deployment flag to false. The database gate fences subsequent
commands; disabling only the environment flag stops new invocations but does not
interrupt one already running. An environment-only pause retains the database
activation epoch, so eligible queued work can resume. To establish a new cutoff
and prevent work accumulated during a pause from starting, use the database
false-to-true transition. Existing unfinished executions from an older generation
cannot continue actions. Rules and history are retained under either control.

Vercel cron calls `/api/cron/automation` every minute. The route follows the existing
notification cron pattern: missing/incorrect bearer secret returns 401 before
privileged access, using a timing-safe comparison. The existing separate email
cron is unchanged. Transport can later change without redesigning definitions,
events, conditions, actions or execution history.

Application JSON logs and database terminalization logs contain only component,
result/error code, delivery/execution/organization/rule/version/event/type and
correlation identifiers. They exclude lease tokens, complete definitions, ticket
descriptions, message bodies, raw SQL/provider errors and credentials.

## Verification and Stage 6 handoff

Final workspace checks:

- `npm test`: **451 passed, 0 failed, 0 skipped**, including existing Stage 1–4,
  routing, SLA, notification, security, employee reopening, conversation/history
  and audit regression suites.
- Stage 5 suite: **32 passed**, including clean migration replay and Stage 4
  upgrade verification.
- `npm run typecheck`: passed.
- `npm run lint -- --max-warnings=0`: passed with zero warnings.
- Tracked and newly created file diff/whitespace checks: passed.

The full suite still emits the existing Node module-type warning from older test
imports; it does not affect test results or the zero-warning ESLint result.

Stage 5 adds 32 tests/subtests covering the complete ticket-created → event →
matching rule → assignment → priority → persisted execution/steps flow, and the
nonmatching zero-action flow. Coverage includes ordering/pagination, both gates,
historical events, two tenants, partial failures, transient rollback, lost-response
recovery, fencing, final-lease exhaustion, upgrade repair, chain/depth/budget limits,
notification authorization/deduplication/atomicity, planner mismatch and cron auth.

Database integration runs the actual worker/repository against replayed SQL through
a test-only RPC adapter with savepoint boundaries. These tests simulate interrupted
and overlapping invocations; they do **not** test independent concurrent database
sessions or PostgREST. The upgrade fixture establishes exhausted Stage 4 execution
history before applying Stage 5 and verifies repair, retained receipts and an
unchanged OFF processing flag.

Pre-production gates remain open: Supabase PostgreSQL 17, actual PostgREST return
shapes/permissions, independent concurrent-session locking and races, declared
Node 24 and its Unicode parity. This environment uses PGlite PostgreSQL 18.3 and
Node 26.8.2. Hosted Supabase advisors and deployment verification were not run.

Stage 6 should consume the existing planner and safe persisted error vocabulary.
It must not activate processing or dispatch these execution RPCs for a dry run.
Account for strict revision behavior between matching rules and distinguish
`retry_exhausted` from an ordinary failed action in future history presentation.
No Stage 1–4 model or authority contract was redesigned.
