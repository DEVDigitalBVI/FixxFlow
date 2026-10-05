# Scheduled and time based Automation (Stage 9)

Stage 9 adds threshold discovery, not another automation engine. Production is
untouched. Deployment remains OFF; this document does not authorize migration or
activation. Stage 10 Operations/Health is not included.

## Authoritative ticket episodes

Migration `20261001160233_automation_temporal_episodes.sql` adds nullable,
server-owned pairs to `tickets`:

| State | Start | Durable identity |
| --- | --- | --- |
| No assigned technician | `unassigned_since` | `unassigned_episode_id` (UUID) |
| `waiting_on_user` | `waiting_on_user_since` | `waiting_on_user_episode_id` (UUID) |

Pairs are either both NULL or both populated. Client INSERT/UPDATE column grants
exclude all four columns. The trigger also overwrites supplied values: on an
unrelated update it retains the old state, including unknown state.

Existing rows remain NULL. There is **no historical backfill** from creation,
updated timestamps, migration time, activity, audit records or old events. An
existing unknown unassigned ticket needs a genuine assignment/unassignment cycle;
an unknown waiting ticket needs to leave/re-enter Waiting on User.

New inserts initialize episodes from the final post-routing assignment/status,
using database `clock_timestamp()`. Assigning a team alone preserves an unassigned
episode. Assigning a technician clears it; subsequent unassignment creates a new
UUID and start. Entering/leaving/re-entering Waiting on User behaves similarly.
Other edits, including messages, priority, category and SLA changes, do not reset
an episode. Resolved/closed tickets are excluded from temporal discovery even if
they retain an unassigned episode.

Trigger order is employee/security restrictions → existing ticket preparation,
routing and SLA preparation → `tickets_y_temporal_episodes` →
`tickets_z_domain_revision` → AFTER event/activity/notification capture. Episode
maintenance is part of the original row mutation, with no additional UPDATE or
artificial revision. Genuine assignment/status changes already increment the
revision, and their snapshots contain the resulting episode. The ordinary event
snapshot additionally allowlists creation, episode pairs, SLA deadlines and
completion timestamps; descriptions and message bodies remain excluded.

## Triggers and time

| Type | Anchor and eligibility |
| --- | --- |
| `ticket.unassigned_duration_reached` | Known unassigned episode, no technician, nonterminal ticket |
| `ticket.waiting_on_user_duration_reached` | Known current waiting episode |
| `ticket.open_duration_reached` | `created_at`, currently unresolved/unclosed; reopening does not reset age |
| `ticket.sla_approaching` | Stored response/resolution deadline; objective incomplete; threshold ≤ now < deadline |
| `ticket.sla_breached` | Stored response/resolution deadline; objective incomplete; now ≥ deadline |

Duration configuration is `{ durationMinutes: integer }`, 1–525600 inclusive
(1 minute–365 days). SLA triggers additionally use
`objective: 'response' | 'resolution'`; breached has no duration. Display units are
minutes/hours/days and never change the canonical storage model. All elapsed-time
comparisons use authoritative UTC timestamps and database time, not browser time
or business calendars. Eligibility begins at **elapsed ≥ duration**. Pure planning
retains PostgreSQL microseconds rather than rounding thresholds to milliseconds.

SLA calculation stays in the existing priority-driven database policy. Response
completion uses `first_response_at`; resolution uses `resolved_at`/`closed_at`,
and terminal tickets are excluded. Priority recalculation changes the stored
deadline, which changes the temporal occurrence identity. No separate SLA policy,
calendar, or pause calculation is introduced. An approaching window missed while
the scheduler is down is not emitted after breach; a breached rule can handle it.

## Discovery, receipts and admission

Migration `20261001160248_automation_temporal_discovery.sql` extends the trusted
registry catalog, adds private cursor/occurrence tables, and adds the service-only
`discover_temporal_automation(rule_limit, ticket_limit)` RPC.

Discovery locks up to 5 enabled, unarchived temporal rules with `FOR UPDATE SKIP
LOCKED`, ordered by least recent scan, then creation time and ID. Each scans up to
100 tickets using a tenant/anchor/ID keyset cursor. The maximum is 500 candidate
rows and 500 emitted events per invocation. A 20-second cooperative work deadline
and 2-second lock timeout further bound processing; the cron route has a 60-second
runtime ceiling. A statement already waiting on infrastructure is not guaranteed
to finish within the cooperative budget.

Each rule's cursor resets after the end of a pass; immutable receipts suppress
repeat emission. Cycling allows changed deadlines and reopened tickets to be
considered without permanently skipping rows behind the previous cursor. Rule
versions/processing generations reset cursors. Partial B-tree indexes implement
actual tenant + anchor-range + ID scans for unassigned, waiting, creation age,
response deadlines and resolution deadlines. Rule selection is indexed by enabled
temporal trigger. These are operational bounds, not commercial limits. Rule
selection may sort the enabled rule set; ticket discovery never loads an unbounded
organization's tickets into the worker.

A receipt uniquely identifies:

`organization / rule / immutable version / ticket / episode`

The version pins trigger and threshold configuration. Episode is the server UUID
for waiting/unassigned; `created` for the ticket's lifetime age; or the authoritative
deadline's epoch value for SLA. Threshold timestamp, trigger, target and event are
also retained. A changed deadline can therefore produce a distinct occurrence;
returning to exactly the same deadline in the same rule version remains deduplicated.

Ordinary domain events retain revision/type uniqueness. A new nullable
`temporal_occurrence_id` extends that unique key using `NULLS NOT DISTINCT`, so
ordinary publishers retain their existing behavior while multiple time thresholds
can exist at the same ticket revision. Temporal events use the same durable event
and delivery tables. They carry system provenance, current revision, a new root
correlation, and allowlisted `temporal` metadata (rule/version, configuration,
anchor, episode, threshold). Subsequent action events retain existing causation.

Each temporal event belongs to its pinned rule/version. Discovery **and the trusted
execution admission RPC** independently verify that receipt; sibling rules and
other versions cannot consume it, even with the same trigger. There is no new
condition evaluator or ticket mutation path. The existing worker/planner executes
conditions and actions; strict revisions, ordering, receipts, stop-on-failure,
retry exhaustion and chain limits remain authoritative. Separate threshold events
can share a ticket revision; an intervening successful mutation may make later
executions stale, by design.

Ticket SHARE locks serialize capture with current ticket mutations. The occurrence,
event, delivery and cursor commit together. Failure/rollback leaves eligible work
rediscoverable; successful commit survives loss of the response. Rule locking and
the durable unique receipt protect overlapping schedulers. All new private tables
have RLS and no direct client/service grants; only constrained service RPCs publish.
Normal administrator reads continue through existing authorized read contracts.

## Backlog and processing controls

An occurrence must satisfy:

`threshold_at > max(processing.activated_at, rule.enabled_at, version.created_at)`

and `threshold_at <= database discovery time`, plus current state requirements.
Ordinary execution admission additionally preserves existing transaction visibility
checks and event-time eligibility. No replay is added. Shortening a threshold below
an already elapsed age does not generate work for that version. Enabling a rule or
reactivating processing does not generate thresholds crossed before that cutoff.
A future genuine episode or deadline can qualify. Pending older executions/events
remain subject to the existing activation generation and backlog protections.

The scheduler requires both existing switches: server
`AUTOMATION_PROCESSING_ENABLED=true` and owner-controlled
`private.automation_processing_state.active=true`. Missing/non-true environment
flags return before constructing a privileged client. The DB RPC independently
returns disabled while inactive. No new UI switch or automatic activation exists.
`/api/cron/automation-scheduler` uses the existing timing-safe `CRON_SECRET` bearer
pattern, with a minute Vercel schedule. Discovery and action processing are separate
invocations; neither sends email directly.

Safe operational logs identify scheduler invocation, tenant, rule/version, ticket,
trigger, threshold and generated event. The RPC summary includes examined/emitted/
duplicate counts. Follow event ID into existing delivery/execution/correlation
logs for action diagnosis. Definitions, ticket descriptions, notes and credentials
are not logged.

## Builder and dry run

The existing WHEN card adds contextual duration/unit and SLA-objective controls.
Summaries derive readable wall-clock durations and explicitly describe creation
age. Existing cards, input/button classes, responsive grids, validation summary,
focus and reduced-motion tokens are reused. All six built-in templates remain
unchanged and valid; no temporal templates are added.

Current-ticket tests use the read-only RPC's database timestamp and authoritative
snapshot; the shared ticket adapter and real planner determine compatibility.
The result includes configured duration, evaluated time, anchor/deadline, threshold,
elapsed duration and known/met status. It is explicitly hypothetical. Unknown
legacy episode starts cannot pass. Retained temporal events use their original
time/configuration and retain the existing current-versus-historical revision
warning. A simulated status/priority transition cannot establish a time episode;
use current or retained temporal context instead. Dry run does not publish or
claim anything and prominently states **No changes were made.**

## Verification and release gates

Run under Node 24:

```
npm test
npm run typecheck
npm run lint -- --max-warnings=0
AUTOMATION_PROCESSING_ENABLED=false npm run build
git diff --check
```

`temporal.test.mjs` covers canonical duration validation, boundary/microsecond
semantics, terminal exclusion, SLA satisfaction, planner/dry-run parity and summaries.
`temporal-database.test.mjs` replays the full chain, upgrades fixtures with unknown
episodes, checks routing/episode/revision behavior, no replay, tenant admission,
SQL/TypeScript boundary agreement, SLA recalculation, bounded paging, rollback,
deduplication, worker completion, nonmatching/stale executions, and exact zero-write
snapshots including both new private tables. `temporal-ui.test.mjs` checks native
controls, configuration, labels/error association, draft preservation and cron OFF/
authorization behavior. Prior application and automation suites remain in place.

For independent sessions, `tests/helpers/automation-temporal-concurrency.mjs`
requires an explicit disposable localhost port. It creates a fresh database and
replays migrations before testing overlapping discovery, two workers issuing the
same action (one note/one attempt), and rollback recovery. It never accepts a hosted
URL or existing application database. Local native PostgreSQL 18.6 passed these
checks; PGlite tests use PostgreSQL 18.3. Neither substitutes for Supabase PostgreSQL
17, actual PostgREST, or hosted independent-session/tenant verification. Those
preproduction gates remain deferred. No production access, migrations, backup
changes or activation are part of this stage.

### Verification record (2026-10-01)

- Node **24.21.0**: full application suite **558 passed, 0 failed, 0 skipped**.
- Typecheck: PASS. ESLint with zero warnings: PASS. Production build: PASS with
  `AUTOMATION_PROCESSING_ENABLED=false`.
- All **38 migrations** replayed cleanly in the PGlite harness and native
  PostgreSQL **18.6**. Upgrade fixtures preserve unknown existing episodes and
  ticket chronology. Native independent discovery/action contention and rollback
  recovery: PASS; isolated processing was reset OFF and the servers stopped.
- Browser fixture at **1440, 834 and 390 pixels**: native keyboard duration/unit
  controls, live summary, hypothetical temporal dry run, no-changes notice and no
  horizontal overflow: PASS. Screenshots inspected. All external requests blocked;
  server actions mocked. This is not a hosted application or screen-reader audit.
- Existing six template tests, prior automation stages and relevant ticket,
  notification, authorization, audit and employee reopening regressions pass.
- Processing OFF verified locally; hosted state deliberately not queried. The
  prepared production backup was not touched. Deferred hosted gates remain open.

### File inventory

New migrations are named above. New modules:

- `src/features/automation/domains/tickets/temporal.ts`: registry configurations,
  compatibility and pure authoritative-time evaluation.
- `src/features/automation/scheduler.ts` and
  `src/app/api/cron/automation-scheduler/route.ts`: server-only discovery boundary.
- `src/features/automation/temporal-controls.tsx` and
  `src/features/automation/temporal-presentation.ts`: builder controls and labels.
- `src/features/automation/temporal.test.mjs`, `temporal-database.test.mjs`, and
  `temporal-ui.test.mjs`: Stage 9 checks.
- `tests/helpers/automation-temporal-concurrency.mjs`: isolated independent-session
  verification.
- `docs/automation-temporal.md`: this design and verification record.

Modified modules:

- `domains/tickets/triggers.ts`, `domains/tickets/dry-run-context.ts`;
  `dry-run-model.ts`, `dry-run.ts`, `dry-run-panel.tsx`;
  `builder.tsx`, `summary.ts`, `validation-presentation.ts`
  (all under `src/features/automation`).
- `src/types/database.ts`: episode read types and constrained discovery RPC.
- `src/lib/events/events-database.test.mjs`: extend the exact approved snapshot
  allowlist and assert new columns remain NULL on legacy rows.
- `tests/helpers/automation-ui-preview.mjs`: temporal synthetic context.
- `vercel.json`: minute discovery endpoint schedule (still gated OFF).
- `docs/automation-administration-ui.md`: link to Stage 9 behavior.

No design-system exceptions or new UI tokens were introduced. Before any future
rollout, review index/unique-constraint lock duration on representative ticket/event
volumes and complete the deferred hosted checks. Stage 10 should observe cursor
lag and missed approaching windows, but no Operations/Health feature was added.
