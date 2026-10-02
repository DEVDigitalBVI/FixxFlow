# Automation Stage 12 — guardrails, resource protection and backpressure

Stage 12 adds safety controls, not Automation capabilities or subscription tiers.
Processing remains OFF. No production Supabase query, remote migration, backup
change, deployment or activation is part of this work. Tests activate only fresh,
disposable databases. Stages 1–11 remain authoritative for eligibility, immutable
versions, tenant authorization, ticket revisions, provenance and receipts.

## Inventory and authoritative model

`src/features/automation/limits.ts` groups the application safety defaults by
meaning. `private.automation_safety_limits()` is the database authority for new
admission ceilings; a parity test binds its values to the application registry.
Existing SQL validators/catalogs remain authoritative mirrors of Stage 1/9
structure and are covered by existing SQL/TypeScript parity tests. No tenant can
raise a ceiling. There is no settings table, plan selection or new environment
configuration. Changing a ceiling requires a reviewed code/schema change.

| Category / boundary | Limit | Authority and semantics |
| --- | --- | --- |
| Structural conditions | 50 | Shared definition validator + SQL validator |
| Structural actions | 1–20 | Ordered, contiguous positions; same validators |
| Condition nesting | One flat AND group | Nested groups and OR remain unsupported |
| Definition bytes (new) | 256 KiB | Compact UTF-8 serialized JSON; excludes insignificant JSON whitespace; database rechecks before persistence |
| Names / descriptions | 120 / 2,000 UTF-16 units | Existing Stage 1 limits |
| Internal notes | 20,000 UTF-16 units | Existing action schema, builder and SQL catalog |
| Identifiers / title condition values | 100 / 180 | Existing identifier and ticket field schema |
| Condition list values | 100 | Existing validator |
| Temporal duration | Integer 1–525,600 minutes | Existing Stage 9 catalog; no new temporal interpretation |
| Generic JSON work | Depth 12; 10,000 nodes; 100,000 aggregate key/string UTF-16 units; array 1,000 | Existing shared bounded JSON guard; distinct from condition nesting and serialized bytes |
| Import envelope | 512 KiB UTF-8; 1 rule; 200 references; nesting 12 | Stage 11 lexical check before parse, then generic JSON/definition validation |
| Portable labels | 180 units | Existing Stage 11 reference format |
| Runtime chain depth | Less than 8 | Existing execution admission |
| Runtime executions per chain | 32 | Existing durable chain row and unique chain claims |
| Runtime action attempts per chain | 100 | Existing action authority; unchanged |
| Delivery attempts | 8 total lease attempts | Existing terminal retry exhaustion and exponential backoff 30s–3,600s |
| Action step receipts | At most one committed attempt | Retransmission returns receipt; rolled-back infrastructure/capacity work costs no action attempt |
| Claim request | Default 5; maximum 20; lease 30–900s (default 120s) | Stage 5 worker RPC; Stage 12 adds tenant rotation and at most 100 candidate eligibility checks per slot |
| Legacy transport claim RPC | Default 20; maximum 100 | Stage 3 service-only transport contract retained; not used by the Automation worker. Execution and notification admission still enforce tenant safety independently |
| Rule discovery page | 50 | Existing keyset pagination, preserved |
| Worker time | 45s cooperative budget; route ceiling 60s | Existing worker |
| Temporal discovery | 5 rules × 100 tickets = at most 500 events; 20s cooperative budget; 2s lock timeout | Existing Stage 9 bounds and cursor/receipt semantics; Stage 12 rotates tenants before rules |
| Operations reads | 1,001 candidates / 1,000 summarized; 24h recent; 50 temporal rules; history 50 rows and at most 31 days | Stage 10, explicit truncation retained |
| Admin/reference reads | 50/page, selected choices 100, page number ≤100,000 | Existing read APIs, separate from active-rule safety |
| Ticket bulk update | 100 selected tickets | Existing ordinary ticket mutation boundary, not an Automation quota |
| Notification email delivery | 6 attempts / 23h horizon; batch default 10, capped 20; backoff up to 60min | Separate from Automation delivery and enqueue accounting; no external-email guarantee added |

The byte guard runs after the bounded JSON guard. Database JSONB numeric rendering
can conservatively retain numeric scale supplied by direct SQL callers; normal
application/import serialization uses canonical JS numbers. Whitespace in text
values remains part of the size. Exact UTF-8 boundary and Unicode tests cover the
normal application contract. No existing rule is rewritten or silently disabled.
An existing oversized definition can be disabled/archived and edited smaller;
new writes/enables must pass current validation.

## New throughput ceilings

| Scope | Ceiling per 60-second window | Reason |
| --- | --- | --- |
| Enabled, unarchived rules per tenant | 100 active (not a time window) | Practical V1 headroom, including queues with >50 rules, while bounding matching/configuration work |
| New execution records per tenant | 120 | Limits condition evaluation, step allocation and downstream mutation pressure |
| Automation delivery claims per tenant | 20 | Bounds overlapping/manual invocations as well as scheduled workers |
| Retry claims per tenant | 5 | Prevents one failing dependency from consuming every admission slot |
| Automation notification inserts per tenant | 120 | Bounds combined explicit and natural ticket-action notifications |
| Automation notification inserts per tenant/recipient | 20 | Protects a single inbox, independently of tenant-wide volume |

These are safety ceilings, not promised throughput. One minute cron with a
five-delivery batch normally handles at most five deliveries per minute platform
wide, fewer when a slot examines ineligible work or defers capacity. Actual
execution throughput depends on matching rules, action latency, time budgets and
tenant count. The higher tenant claim ceiling protects overlapping authorized
workers without changing the production cadence.

Counters use a fixed 60-second window beginning at first admission (or first
admission after expiration), not a sliding window. Boundary bursts can approach
twice a limit over a rolling 60 seconds. No real-time throughput guarantee is
claimed. Each counter is one row per organization/resource/recipient and resets
in place; repeated windows do not create more rows.

Active enables update a dedicated tenant row before counting enabled rules. This
serializes concurrent enables and produces serialization failure rather than a
snapshot-based overrun under stronger isolation. Disabled/imported/archived rules
do not consume the allowance. Existing excess enabled rules survive an upgrade;
additional enabling is refused until below the ceiling. Idempotent enablement of
an already enabled rule does not consume another slot.

## Durable deferral and accounting

New execution admission is charged only after existing eligibility/chain checks,
before evaluating conditions or inserting the execution. A nonmatching rule
counts: evaluating conditions and persisting the skipped history consume work.
An ineligible rule, rejected chain, duplicate execution receipt or dry run does
not consume new execution capacity. Temporal discovery does not reserve execution
capacity: it commits durable events first; later execution admission is separate.

On exhaustion, `FF002` / `execution_deferred_capacity` or `FF003` /
`notification_deferred_capacity` propagates out of the RPC. The RPC rolls back its
work. The worker records a fenced `deferred` delivery outcome with capacity reason,
first deferred timestamp and availability 60 seconds later. It refunds the claim's
attempt increment. The token makes repeated defer acknowledgement idempotent.
Earlier committed steps/executions remain; a later lease resumes through existing
receipts. Capacity is not action failure, retry exhaustion or administrative audit.
Failure backoff/error fields remain independent. A crash or unavailable defer RPC
can still consume a lease attempt, as it is a genuine delivery recovery failure.

Claim-capacity rejection happens before creating a lease or incrementing attempts;
it records `worker_deferred_capacity` directly. Retry admission alternates with
fresh work within the bounded candidate sample. Retry checks precede the overall
claim check; a retry reservation may be consumed if the overall claim ceiling then
rejects it. This is conservative admission accounting, never extra failure retries.
Execution retries with existing receipts cost no new execution slot, but every
new lease consumes claim capacity and existing failed leases consume retry capacity.
Stale action attempts continue consuming the existing chain action budget; a
notification capacity rollback refunds the entire action transaction and budget.

Notification admission runs AFTER a genuinely new inbox INSERT while a trusted
Automation command context exists. Thus `ON CONFLICT` duplicates cost nothing;
explicit send_notification and ticket side-effect notifications share the same
protection. Inbox, email outbox, ticket mutation, receipt and counters commit or
roll back together. Recipient identity and tenant derive from trusted database
rows. Ordinary user ticket operations do not have an Automation command context
and never consume these counters or wait for this capacity. Email credentials
and external email retries remain independent; exactly-once external delivery is
not promised.

A single action that would notify more than 120 recipients can never fit this
atomic notification model. It terminates with `notification_fanout_limit` (a
persisted, visible guardrail outcome), with no changes from that action committed.
The unassigned-ticket reopen path checks at most 121 eligible recipients before
mutation; a context counter also bounds actual inserts. This deliberate terminal
structural fanout guard avoids endless deferral of intrinsically impossible work.
Temporary tenant/recipient saturation always defers. No notifications are silently
omitted from an otherwise successful action. Future chunked notification intents
would require a separate design preserving action/receipt semantics.

## Fair scheduling, bounded inspection and discovery

A private tenant schedule row tracks last claim/discovery service. Workers select
the least recently serviced eligible tenant with `FOR UPDATE SKIP LOCKED`, then
one delivery. Every slot advances the tenant timestamp, including capacity denial.
A large tenant cannot retain first place by adding older work. Within a tenant,
fresh/retry preference alternates even after a retry-capacity refusal.

Only the first 100 ready delivery candidates beyond a durable scan cursor undergo
eligibility checks in a slot. If none are actionable, the cursor advances beyond
that sample; at the end it resets. This avoids rescanning an unbounded prefix of
ineligible historical events. It can take multiple invocations to discover work
beyond that prefix. Empty/ineligible tenant visits consume slots, so fairness is
reasonable eventual progress, not perfect utilization or latency fairness.

Discovery applies the same durable tenant rotation, then least-scanned eligible
rule within that tenant. Each rule is visited at most once per invocation. The
existing 5 × 100 cap, 20s budget, ticket keyset cursor, transaction rollback,
activation/version cutoff, temporal unique receipts and lag observations remain.
The active-rule cap bounds each tenant's enabled configuration set. No separate
per-tenant temporal rate counter is needed at the current global 500-candidate
invocation ceiling; authorized scheduler concurrency must remain operationally
bounded. Discovery under backlog can miss approaching windows; Stage 10 continues
to expose lag and missed-window observations rather than fabricate events.

## Operations and queue thresholds

All queue metrics remain scoped to the authorized administrator's organization.
Capacity deferred count, notification-deferred subset and oldest deferred time are
separate from retries, action failures and retry exhaustion. New terminal fanout /
chain safety outcomes have a separate execution count and readable labels.
Capacity-only worker invocations count as successful service operation; the tenant
queue reports Delayed. Platform heartbeat contains no tenant counts or identities.
Metrics refresh with the page; no repetitive live-region announcements are added.

Operational meaning (no arbitrary traffic-light count thresholds):

- Any observed capacity deferral means intentional **Delayed by capacity**.
- Oldest actionable queue age >180 seconds means delayed: one 60s cadence plus
  the existing two-interval grace period.
- Pending deliveries alone are not a failure; historical ineligible work is
  reported separately. Counts beyond 1,000 are lower bounds, not exact totals.
- A retry queue alone retains existing retry/backoff semantics. Above five retry
  claims per tenant/window, capacity delays further attempts; fresh work gets turns.
- Any observed exhausted or terminally failed delivery means Degraded; maximum
  eight attempts and retry-exhausted history are unchanged.

There is deliberately no hard queue-size rejection: rejecting new durable events
would make ordinary user mutations fragile or lose legitimate work. A persistent
arrival rate above service throughput requires operator intervention (reduce
incoming bulk/automation activity, investigate failures, or separately approve
more service capacity). The current system cannot guarantee finite storage while
accepting unlimited ticket mutations; retention/capacity planning remains a
release requirement, not an implicit data-deletion feature.

## Storage growth and future retention

These are explicit per-tenant illustrative daily row budgets, not measurements.
Assume 2 steps per admitted execution (20 at the structural ceiling). Domain-event
counts include ordinary ticket events, action-derived events and emitted temporal
events; each creates one delivery. Missed SLA windows create observations, not events.

| Daily rows | Normal | Moderate | High but allowed |
| --- | ---: | ---: | ---: |
| Ordinary + action-derived domain events | 1,000 | 5,000 | 100,000 |
| Temporal occurrences (and additional events/deliveries) | 100 | 1,000 | 20,000 |
| Total domain events / deliveries (each) | 1,100 | 6,000 | 120,000 |
| Executions incl. nonmatches | 200 | 4,000 | 172,800 |
| Steps at assumed 2 / max 20 per execution | 400 / 4,000 | 8,000 / 80,000 | 345,600 / 3,456,000 |
| Missed SLA observations | 0 | 100 | 10,000 |
| Worker + discovery invocation records (platform, not per tenant) | 2,880 | 2,880 | 2,880 |

High execution ceiling is 120 × 1,440 windows/day, requiring enough eligible
rules, claims and authorized worker invocations; the current five/minute cron
will often be the tighter limit. At default cadence, platform delivery service is
at most 7,200/day: moderate 6,000 arrivals already leave little shared headroom;
120,000 eligible arrivals would add at least 112,800 queued deliveries/day.
Temporal discovery's global theoretical ceiling is 720,000 emitted events/day
(500 × 1,440), far above default delivery service. This mismatch is visible backlog,
not capacity to promise commercially. Thirty-day counts are the daily figures ×30;
high step allocation alone could reach 103,680,000 rows in that envelope.

Rule versions, audit records, chain/claim rows, notifications and outbox rows add
storage beyond this table. New capacity state is ≤4 aggregate rows per active
tenant plus one row per distinct recipient and one schedule row per organization;
there is no per-defer log table. Measure `pg_total_relation_size`, index sizes,
average `pg_column_size`, autovacuum and write amplification on representative
staging data before converting these budgets to bytes or commercial capacity.

Recommended future policy, requiring explicit approval and bounded jobs:

- Invocation detail: 30 days, daily summaries for 12 months; retain failed/crashed
  invocation detail 90 days where support needs justify it.
- Successful delivery/execution detail: candidate 90 days online, longer immutable
  archive according to customer audit requirements; failures 180 days online.
- Keep pinned versions, source events and provenance at least as long as any
  execution/step references them. Archive the connected history, not isolated rows.
- Temporal occurrences/missed observations and notification/action receipts are
  deduplication evidence. Retain while the rule version/episode or any queued work
  can revisit them; do not delete merely because they are old.
- Chain claims/counters must survive all corresponding pending work and retries;
  deleting them early reopens recursion/idempotency budgets.
- Never purge pending, leased or capacity-deferred deliveries on an age threshold.
  Design archival, FK order, legal retention and recovery together. Stage 12 deletes
  no operational history and schedules no retention task.

## Security, indexes, upgrade and configuration failure

The two new private tables have RLS and no direct anon/authenticated/service grants.
Only existing constrained SECURITY DEFINER worker paths can use private counter
helpers. Administrator visibility still requires active same-tenant membership,
role and MFA; platform ownership alone confers no tenant access. No new public
accounting RPC or client-supplied tenant authority exists. Runtime deferrals create
no audit events; normal administrative rule edits retain their existing audit.

New indexes are only the two small schedule order indexes (last serviced timestamp,
organization ID); the capacity primary key supports exact locked accounting.
Existing tenant/availability delivery, execution/delivery, active-rule/trigger,
notification deduplication, temporal ticket-anchor and Operations indexes cover
new queries. Bounded candidate materialization precedes expensive eligibility.

The migration is transactional (`20261002202406_automation_guardrails.sql`). It seeds one schedule row per legacy organization,
adds nullable delivery capacity fields, defaults context counters, leaves existing
rules/history untouched and never changes the processing gate. New indexes build
on new tables; ALTER TABLE and replacement constraints on existing delivery,
execution/step/context tables require locks. A future production rollout must
measure table size, constraint scan and lock durations; stage validation or use a
maintenance window/appropriate validated-constraint strategy. No remote migration
or hosted advisor call was made.

Missing/malformed external safety configuration cannot mean unlimited work: none
is accepted. A missing/invalid counter ceiling fails with capacity deferral.
Migration dependencies commit atomically; deploy the database migration before
application changes, with processing OFF. Unexpected schema/version faults remain
real infrastructure faults under the established bounded retry/failure policy;
monitor before enabling rather than using them as a bypass. Environment processing
flags retain the existing exact-`true` requirement; unset/malformed remains OFF.

## Verification and release checklist

Verification record is completed after the checks below. Tests use Node 24 and
PGlite PostgreSQL 18; independent sessions use disposable native PostgreSQL 18.6.
Neither replaces Supabase PostgreSQL 17, PostgREST or hosted MFA/tenant verification.

Required local checks: targeted guardrails/worker/temporal/Operations suites, all
application tests, typecheck, zero-warning ESLint, production build with processing
OFF, diff checks and independent enable/execution/recipient contention.

Staging follow-ups: representative multi-tenant backlog and retry mix over hours;
EXPLAIN (ANALYZE, BUFFERS) for claiming/counters/discovery/Operations at realistic
sizes; lock waits, deadlocks, p95 action latency, vacuum/index bloat, fair progress,
window-boundary bursts, scheduler concurrency, storage byte measurements and
migration locking. Use controlled tens/hundreds of thousands of rows outside CI.
Do not treat the deterministic hundreds-of-events tests as a load benchmark.

UI reuses builder validation/error summary, ActionForm enable feedback, existing
Operations cards/metrics, badges, alerts and responsive/focus tokens. No design
exception, new module, UI library, icon family or tokens. Full VoiceOver/NVDA audit
remains a release checklist item: focus/associated validation errors, enable-limit
recovery, text distinction among delay/failure/exhaustion, headings/disclosures and
responsive metric reading order. No auto-refresh live announcements are added.

### Local verification record — 2026-10-02

- Node 24.21.0: full application suite **707 passed, 0 failed, 0 skipped**.
  Follow-up guardrails/temporal checks after the deadline-fairness correction:
  **46 passed**. Clean 40-migration replay and legacy >100-enabled-rule upgrade
  preserve existing rules and processing OFF.
- Typecheck PASS; ESLint with zero warnings PASS; production build PASS with
  `AUTOMATION_PROCESSING_ENABLED=false`; diff whitespace checks PASS.
- Disposable native PostgreSQL 18.6: concurrent enables cannot exceed 100;
  competing execution admissions cannot exceed 120; competing recipient enqueues
  cannot exceed 20; rejected notification action retains zero attempts. PASS.
- Native slow-discovery regression (20.05s synthetic delay): an unvisited tenant
  is not marked serviced when the budget expires and progresses next invocation.
  PASS. Database processing returned OFF after tests.
- Bounded synthetic tests cover 240 competing events, 100-ticket ordinary bulk
  update and later drain, 130 candidate executions crossing the 120 limit,
  notification-heavy two-tenant work, retry saturation, 210 temporal tickets,
  malformed/missing ceilings, zero-write dry runs, imports and all six templates.
- Browser verification is **partial**: Safari desktop screenshot and 390px
  responsive stacking inspected; accessibility tree contains separate capacity,
  notification, action-failure and retry-exhaustion labels and semantic metrics.
  Native control then failed with `noWindowsAvailable`, preventing completion of
  tablet/desktop/mobile queue screenshots and keyboard checks. Component tests
  cover the new text/statuses, shared responsive structures and absence of noisy
  live regions. Full responsive interaction and VoiceOver/NVDA audits remain open.
- Shell processing flag is unset/OFF; `.env.example` remains OFF. Production
  state was deliberately not queried. Prepared backup and remote migration
  history were not accessed or modified. Nothing was deployed.

New files: this assessment, `limits.ts`, `guardrails.test.mjs`, the Stage 12 SQL
migration and `tests/helpers/automation-guardrails-concurrency.mjs`. Existing
worker/error types, validators/builder, Operations metrics/presentation and tests
are extended in place. The independent-session harness requires an explicit
`FIXXFLOW_GUARDRAILS_TEST_PORT` on a freshly initialized disposable localhost
PostgreSQL cluster; it creates its own new database and never takes a hosted URL.
