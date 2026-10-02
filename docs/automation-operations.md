# Automation Operations — Stage 10

Stage 12 adds [guardrails and capacity backpressure](automation-guardrails.md); its
limits, scheduling and capacity-state semantics extend this stage's contracts.


Stage 10 observes the existing engine. It adds no retry/replay/force-run controls,
changes no ticket action semantics, and does not activate processing. Production
Supabase and the previously prepared production backup were not accessed.

## Architecture and access

`/app/administration/automations/operations` shows availability, a recent execution
summary, queue/discovery observations and recent failures. `/operations/history`
provides global **organization-only** execution history. Both inherit the existing
Administration layout and use `requireAutomationAdmin()` plus the authenticated
Supabase client. SQL separately requires an explicit organization administrator
and `private.has_required_assurance()`. Platform ownership alone grants no access.
Caller-supplied organization IDs cannot bypass database authorization.

Migration `20261001165514_automation_operations.sql` adds:

- `private.automation_runs`: one record per authorized worker/discovery invocation,
  with UUID, kind, database start/completion timestamps, outcome and allowlisted
  integer counters. Duration is completion minus start; unfinished duration is
  intentionally unknown. No ticket content, rule configuration or exceptions.
- `private.automation_missed_windows`: one observation per organization, pinned
  rule/version, ticket and authoritative deadline episode. Composite foreign keys
  preserve tenant ownership. Includes eligibility, deadline and observation times.
- Service-only `start_automation_run` and `finish_automation_run` RPCs. Finish locks
  the run; repeated identical completion is idempotent, conflicting completion
  returns false. Independent runs never overwrite one shared heartbeat row.
- Administrator-only `read_automation_operations` and
  `read_automation_operations_history` RPCs, with private implementations.

Both private tables have RLS enabled, no client policies, and no direct table
privileges for authenticated, anonymous or service roles. Service writes use the
narrow RPC boundary. The existing scheduler alone writes missed-window receipts.
Viewing Operations creates no audit events or other application writes.

`operations-telemetry.ts` wraps existing cron work. Authorization and deployment
OFF checks happen before telemetry starts. Failed work records a safe failed
outcome and rethrows into the established route error handler. Telemetry errors
log only `telemetry_unavailable`; they neither grant execution authority nor
prevent existing work. A crash or failed completion write can leave a run marked
running; time-based health then reports delay. No housekeeping mutation is needed.
Worker counts cover claimed/acknowledged/retried/deferred deliveries, distinct
observed executions and failures. Discovery counts cover scanned rules, examined
tickets, emitted occurrences and duplicates. The existing temporal cursor remains
the source of per-rule progress. These counters are platform-private.

## Exact health semantics

`operations-model.ts` centralizes UI health. Both configured cron intervals and
route execution ceilings are 60 seconds; tests bind the policy to `vercel.json`
and route configuration. SQL's SLA cadence boundary is also 60 seconds.

In precedence order, worker/discovery health is:

1. **Disabled:** deployment flag is not `true`, or database processing is inactive.
2. **Unknown:** no invocation has started.
3. **Delayed:** latest invocation is unfinished for more than 120 seconds, or its
   start is more than 180 seconds old.
4. **Degraded:** newest-started completed invocation failed, or completed with
   failures/retries/deferred work.
5. **Unknown:** no successful invocation yet (for example a first run in progress).
6. **Healthy:** last success is no more than 180 seconds old; otherwise **Delayed**.

The newest-started completed run determines completed outcome/time. A slow older
run finishing later cannot replace a newer invocation's result. Last success is
separately the greatest successful completion timestamp. A recent success is a
cadence signal, not proof every rule/ticket was scanned or every action succeeded.

Tenant administrators see sanitized platform **availability** timestamps/results,
never global counts, run IDs, other organizations, metrics, or cursor contents.
All queue, execution, threshold and per-rule counts are organization-scoped.

## Discovery lag and SLA approaching risk

For emitted temporal occurrences:

`lag = domain_events.occurred_at - temporal_occurrence.threshold_at`

The event timestamp is the trusted database evaluation time while the ticket is
locked. This measures discovery lateness, not transaction commit, delivery or
action latency. The overview shows latest and maximum observed lag over 24 hours;
it makes no percentile claim. PostgreSQL microseconds are retained for boundary
classification (the display rounds seconds upward).

For an approaching SLA with threshold T, deadline D and observation O:

- **Within cadence/useful window:** T ≤ O < D and O − T ≤ 60 seconds.
- **Late before deadline:** O < D and O − T > 60 seconds.
- **Missed window:** O ≥ D, including exactly D. No approaching event is emitted,
  and nothing is converted into a breach. The scheduler records an observation
  only in its existing skip branch, in the same transaction as cursor progress.

Missed observations deduplicate on organization/rule/version/ticket/deadline
identity. Previously emitted occurrences are excluded, so a later scan cannot
falsely turn a successful discovery into a missed window. Rollback loses the
observation and cursor movement together; the next scan can observe it again.
The existing rule locks and unique constraints protect overlapping invocations.

Coverage is deliberately limited: a ticket already satisfied/resolved before
scanning is excluded, and old thresholds outside enablement/activation/version
cutoffs remain excluded. Stage 10 does not reconstruct all historical misses.

An enabled approaching rule has a **window-risk warning** if no scan is recorded,
scan age reaches its configured window, or maximum recent tenant discovery lag
reaches that duration. This is a conservative signal, not proof of a particular
miss. Scan progress is a batch observation, not a guaranteed complete sweep. OFF
suppresses active risk alarm wording. SLA deadlines and threshold semantics do
not change.

## Queue and execution read models

Outstanding queue candidates are ordered by availability/id and capped before
eligibility inspection. A delivery is actionable under the existing admission
predicate, an existing execution, or exhausted-attempt cleanup. Nonactionable
pending events are shown separately; they are not falsely labelled actionable
backlog. Categories include ready/expired lease, live lease and scheduled retry.
Oldest observed eligible age uses delivery creation time, so retry time remains
part of backlog age. Recent outcomes separate completion, recovery after retry,
retry exhaustion and other terminal failure.

Queue health: OFF → Disabled; observed terminal failures/exhaustion → Degraded;
oldest observed eligible age >180 seconds → Delayed; truncated pending/recent
samples → Unknown; otherwise Healthy. This describes the bounded observations.

Every aggregate category reads at most 1,001 candidates and summarizes at most
1,000. Truncation is explicit: counts are partial/lower bounds and maxima may be
incomplete. Recent categories use a 24-hour window; temporal progress shows the
first 50 enabled temporal rules, with an explicit truncation indicator.

Global history defaults to 24 hours, allows at most 31 days, and returns 50 rows
plus a next-page indicator. Timestamp/UUID keyset pagination preserves the same
window across pages. Filters: literal historical automation name, trigger, result,
UTC date range and exact ticket number. Names and versions come from pinned
execution records, never today's definition. Detail links reuse Stage 7's pinned
version rendering. Action failure, delivery failure and retry exhaustion remain
separate. No raw exception or snapshot blobs are returned.

Indexes serve these actual reads: three run indexes for newest/latest-completed/
success; tenant/time indexes for occurrences, missed windows and executions;
partial tenant/availability and tenant/completion delivery indexes. Existing rule,
step and tenant foreign-key indexes serve joins. No ticket indexes were added.
New regular indexes take write-conflicting locks while built; future deployment
must measure build time on representative volume. No production migration is
performed by this stage.

## Growth and future retention

No rows are purged. At uninterrupted one-minute cadence, two workers produce up
to 2,880 run records/day (86,400/30 days), plus retries/manual authorized cron
invocations. OFF at deployment level creates none. Crashed runs remain evidence.
Domain events/deliveries grow with meaningful ticket events and each distinct
rule/version/episode threshold. Executions grow with admitted rule/event matches
(including condition skips), and steps with configured actions. Missed receipts
grow once per still-observable missed rule/version/ticket/deadline occurrence.
Repeated scans add no duplicate receipts. Actual bytes depend on action counts,
allowlisted snapshots and indexes; no unsupported storage-size estimate is made.

Before activation at scale, measure actual per-tenant rates/bytes. Design a separate
approved retention job with legal/support requirements, bounded batches and FK
order. Consider short operational-run retention with daily aggregates, longer
failure history, and archival for execution versions/events needed for provenance.
Never delete deduplication/chain/receipt records while events or retries could
still reference them. Retention windows and deletion are not implemented here.

## Troubleshooting

1. Check processing OFF/ON first. OFF is intentional; rule enablement cannot turn
   it on. There is no Operations kill-switch control.
2. Compare worker and discovery start/completion/success with the cadence definitions.
   Unknown means no evidence, not health. Check protected cron delivery and logs.
3. Inspect actionable backlog, oldest observed age and retries. Check truncation
   before drawing conclusions from zero counts.
4. Filter global history to failures, then open the execution. Inspect its pinned
   rule version, completed/unattempted steps and safe failure reason.
5. Expand Operational identifiers on execution detail: execution, event, delivery
   and correlation IDs connect to existing structured server logs. Logs must not
   contain message bodies, descriptions, credentials or full definitions.
6. For temporal issues inspect rule scan time, recent discovery lag and missed
   windows. Review configured duration versus actual cadence/capacity; never fix
   lag by changing authoritative deadlines or replaying historical work.
7. Investigate `telemetry_unavailable` in deployment logs if heartbeat evidence
   disappears while work continues. Check migration availability/RPC grants.

## Files and UI

New modules: `operations-model.ts`, `operations-telemetry.ts`,
`operations-service.ts`, `operations-view.tsx` under `src/features/automation`;
two Operations routes; the migration above; `operations.test.mjs`,
`operations-database.test.mjs`, `operations-ui.test.mjs`; synthetic Operations
fixture and localhost preview helper; this document.

Existing integration edits: both cron routes, database RPC types, Automation list
navigation, execution detail's identifier disclosure, shared header's optional
back label, global CSS layout classes, existing cron test mocks, native concurrency
helper and Administration documentation link. Stage 1 planner, action authority,
retries, immutable definitions, revision guards and execution behavior are unchanged.

Reused `AutomationHeader`, existing settings cards/buttons/fields/badges/alerts,
responsive table regions, typography/spacing/color/focus tokens and ticket date /
execution presentation functions. No new palette, library or animation. Native
forms/disclosures support keyboard operation; headings, labels, table captions,
row/column headers and text health labels remain semantic. Error/loading boundaries
are inherited from Automation administration. No design-system exception.

## Verification — 2026-10-01

- Node 24.21.0: full application suite **579 passed** (558 existing +21 Stage 10).
  Includes clean 39-migration replay, Stage 10 legacy-data upgrade, authorization/
  MFA/two-tenant reads, immutable history/pagination, bounded samples, lag/window
  observations, run overlap/idempotency, server and presentation tests.
- Typecheck PASS; ESLint with zero warnings PASS; production build PASS.
- Disposable native PostgreSQL 18.6: clean replay PASS, independent overlapping
  discovery PASS, duplicate action/one note/one attempt PASS, rollback recovery
  PASS, concurrent heartbeat completion PASS; returned to processing OFF.
- Isolated Chromium, real components/CSS and synthetic data: OFF/unknown/healthy/
  degraded/history pages at 1440, 834 and 390px: no document overflow; keyboard
  disclosures/filter tab order and visible focus checked; reduced-motion enabled.
  No authenticated hosted browser session or real screen reader is claimed.
- Pending screen-reader audit: VoiceOver/NVDA navigation across health headings,
  disclosures, definition lists, responsive tables, filter errors and pagination;
  announce retry exhaustion distinctly. Add this to the full Automation audit.

Deferred gates remain: Supabase PostgreSQL 17, actual PostgREST, representative
hosted concurrency and tenant isolation, hosted worker end-to-end, failure recovery,
kill switch and deployed observability. Local PG18/PGlite tests do not close them.
Processing stays OFF in deployment configuration; isolated tests alone enable it.
Production, remote migration history and backup remain untouched.
