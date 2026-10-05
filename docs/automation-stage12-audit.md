# Stage 12 implementation audit

**Historical audit:** the findings below describe the reviewed baseline. Subsequent
fixes and their evidence are recorded in [Stage 12 corrections](automation-stage12-corrections.md).
This report retains the original failures and does not describe the corrected tree.

**Decision: do not approve production activation.** The audit found two new
high-priority upgrade/recovery defects, reproduced the known scheduling defect
behind the failed capacity target, and found a history-classification defect.
Passing the existing suite does not cover these cases.

This is an implementation review, not another product stage or an activation
approval. No application code, migration, safety ceiling, cadence, credential or
production setting was changed. Existing Stage 12C work was preserved.

## Baseline and scope

Reviewed commit: `048a16280310b65838192d5ac1aef8100a5bd6bc` (`stage 12B`).
Stage 12 implementation: `bd4cd421b9aaca9e7fc58ae816deea901898b162`, compared
with its parent `d782fc3`. Stage 12B changed Operations explanatory copy and its
test, plus verification artifacts; it did not fix the guardrail implementation.
The uncommitted Stage 12C work consists of documentation/manual verification
helpers, not different application or migration code.

The review covered every Stage 12 application/migration diff and followed the
affected paths into rule persistence, event delivery, execution authority,
notification triggers, worker recovery, temporal discovery, Operations, imports,
templates and dry run. Established Stage 2/4/5/6/8/9/10/11 documentation and the
Stage 12 limits/accounting contract informed the review. Security checks included
new grants/RLS, definer search paths, trusted tenant derivation, counter mutation
authority and administrator visibility. This is not a claim of exhaustive
repository-wide penetration testing or a fresh hosted security assessment.

There are 40 migration files; the latest remains
`20261002202406_automation_guardrails.sql`. Source references below use the
reviewed files and line numbers, not proposed fixes.

Evidence: [machine-readable audit record](automation-stage12-audit-evidence.json),
[Stage 12C report](automation-stage12c-verification.md) and its separately
identified historical capacity measurements.

## Confirmed findings

### A1 — P1: a legacy temporal rule can stop discovery across tenants

**Location:** `supabase/migrations/20261002202406_automation_guardrails.sql:474`
and the new byte check at line 84.

Stage 12 preserves previously valid rules but applies the new 256 KiB validator
inside the shared discovery transaction. A pre-upgrade definition with five
18,000-character CJK notes is valid under the prior note, character, action and
JSON bounds. Its compact serialization is **270,665 bytes**. Creating and enabling
it through the pre-Stage-12 administrator RPCs succeeds.

After the unchanged Stage 12 migration, discovery throws `FF004` when it reaches
that rule. There is no per-rule failure isolation. All cursor, occurrence and
tenant-schedule updates in the invocation roll back, so the next scheduled
invocation encounters the same rule again. A healthy organization's temporal
rule cannot make progress under this repeated serial invocation pattern. This is
cross-tenant availability impact, not only an invalid-rule message.

**Fresh evidence:** both PGlite and native Supabase PostgreSQL **17.11** reproduced
three consecutive `FF004` failures, unchanged tenant scheduling state and **zero
healthy-tenant scans**. The healthy tenant had a valid enabled temporal rule;
no ticket threshold or artificial delay is needed to trigger the failure.

**Required correction:** define how previously valid definitions participate in
runtime validation, and prevent a rule-local validation failure from repeatedly
rolling back unrelated tenant progress. Preserve bounded work, immutable versions,
processing controls and explicit administrator-visible outcomes. Do not solve
this by silently disabling legacy rules or broadly swallowing infrastructure
errors. Add a two-tenant upgrade regression before approving the correction.

### A2 — P1: the same legacy rule cannot be disabled or archived

**Locations:** new validator at
`supabase/migrations/20261002202406_automation_guardrails.sql:84`; existing
table CHECK at `20261001014435_automation_rule_definitions.sql:207`; lifecycle
UPDATE at that migration's line 263.

The table CHECK calls `private.validate_automation_definition(definition)` on
row updates. Replacing that function with a stricter implementation means
disabling or archiving an existing oversized rule fails the CHECK, even though
the management RPC deliberately avoids explicit definition validation for those
operations. Both RPCs fail with **`FF004`**, leaving the rule enabled.

This contradicts the Stage 12 documentation's statement that oversized existing
definitions can be disabled/archived, and removes the expected administrative
recovery path for A1. An administrator can first edit the definition smaller,
but needing a configuration rewrite before an emergency disable is a defect.
The global processing OFF control still exists; this finding does not claim it
can be bypassed.

**Fresh evidence:** the same genuine pre-upgrade rule failed both lifecycle RPCs
on PGlite and PostgreSQL **17.11**, after a successful unchanged upgrade.

**Required correction:** enforce the new byte ceiling on the intended new-write /
edit / enable boundaries while preserving disable/archive and immutable history.
Avoid leaving existing rows inconsistent with a CHECK's changed interpretation.
Also test logical backup restoration with this fixture: the stricter CHECK is a
restore-compatibility risk, although a complete restore of this particular fixture
was **not** run in this audit. The prior restore used small definitions and does
not close this case. Use a forward corrective migration; do not rewrite migration
history to conceal the incompatibility.

### A3 — P1 capacity gate: ineligible tenant visits consume delivery slots

**Location:** `supabase/migrations/20261002202406_automation_guardrails.sql:365`,
especially outer tenant selection at 366–369 and the `continue` at 381.

The configured batch of five is implemented as five **tenant visits**, including
visits that find no eligible delivery. A tenant with one permanently ineligible
historical event stays in the outer selection forever. Repeated visits to it use
processing slots even while another tenant has ready legitimate work. Nothing
requires successful claims to fill the batch within a separately bounded scan
budget. The durable cursor bounds inspection but does not eliminate these
recurring empty visits.

**Fresh reproduction:** one tenant with an ineligible event, one tenant with 20
ready events, and four default worker calls. Only **8 of 20 available slots**
produced completed deliveries, without an action failure or capacity-counter
rejection. PGlite's timestamp ties affect the exact rotation sequence; this is a
functional utilization reproduction, not a throughput benchmark.

**Previously measured native/application evidence, not rerun here:** Stage 12C's
unchanged default-cadence workload observed about **4.21 arrivals/minute versus
3.41 completions/minute**, with oldest actionable work exceeding 11 minutes.
The backlog ultimately drained, with no lost delivery, but the acceptance target
failed. Those measurements are local and workload-specific, not hosted capacity.

**Required correction:** separate the successful-claim budget from a bounded
tenant/candidate-inspection budget, and avoid repeatedly revisiting exhausted
tenants within an invocation. Preserve fairness and a defensible total query-work
bound; measure additional database cost. Do not simply raise batches or cadence.
Retest ineligible prefixes, many inactive tenants, competing small/large tenants
and retry-heavy queues at the established cadence. The discovery ceiling of
500 events/invocation versus at most five default worker claims/minute remains a
separate capacity-planning bottleneck even after utilization improves.

This tradeoff was documented in Stage 12, so it is not newly discovered behavior.
The reproduced implementation and failed Stage 12C workload make it a remaining
release blocker rather than evidence of adequate commercial capacity.

### A4 — P2: history treats a notification guardrail as an action failure

**Locations:** the Stage 12 summary classification at
`supabase/migrations/20261002202406_automation_guardrails.sql:423`; the unchanged
history filter at `20261001165514_automation_operations.sql:139`.

Stage 12 excludes `notification_fanout_limit` and `chain_limit` from Operations'
Action failed total and counts them under Safety limit reached. It did not update
the history RPC's `action_failed` predicate, which excludes only retry exhaustion
and delivery failure. The same terminal safety outcome therefore appears in the
Action failed history filter. The row's readable safety label exists, but the
filter and total disagree.

**Fresh evidence:** an actual reopen action exceeding the atomic notification
fanout allowance produced one `notification_fanout_limit` execution. Operations
returned `guardrailTerminated=1` and `actionFailed=0`; the Action failed history
filter returned that execution. This used the real migrated RPCs and worker in
PGlite, not a fabricated execution status.

**Required correction:** align summary and history classifications and test them
together. Preserve a readable path to safety outcomes in history without adding
a new administration module. The same predicate should account consistently for
the already supported `chain_limit` outcome.

## Requirement coverage and remaining limits of the evidence

PASS below means the indicated implementation/property passed the reviewed
evidence; it does not override A1–A4 or approve the whole stage. Fresh means this
audit ran it; prior means the unchanged-code Stage 12B/C evidence was reviewed.

| Original requirement area | Assessment | Evidence and remaining work |
| --- | --- | --- |
| 1–4: inventory, categories, structural validation | PARTIAL | Shared registry, existing distinct boundary limits, server/SQL enforcement and exact/over-limit tests pass fresh. New byte limit's legacy interactions fail A1/A2. Flat AND remains the only supported condition group. |
| 5: active-rule cap | PASS for tested paths | Durable tenant-row serialization, active-only counting, disabled imports and archived exclusions; fresh suite and prior independent PG17 contention/101-enabled upgrade. No subscription configuration. Prior >100 test omitted oversized definitions. |
| 6–7: durable execution capacity and deferral | PASS for tested accounting; capacity gate FAIL | Row-locked database counters; nonmatches charge execution admission; existing receipts do not. Deferral preserves work and refunds the lease attempt. New execution and notification saturation/resumption pass fresh; A3 limits actual service. |
| 8: tenant fairness | PARTIAL | Fresh two-tenant and hundreds-of-events tests show progress for valid workloads. A1 can defeat temporal fairness; A3 wastes shared capacity. No mathematically perfect fairness claim. |
| 9: notifications | PASS for tested protection; presentation FAIL | Tenant/recipient keys derive from trusted rows. Guard runs after a new inbox insert, so deduplicated inserts are not charged. Action/counters/notification/outbox roll back together on capacity denial; receipts survive recovery. Atomic fanout rejection remains explicit. A4 misclassifies its history filter. |
| 10: temporal discovery | PARTIAL / FAIL legacy case | Five rules × 100 tickets, keyset cursors, receipts, time/lock bounds and lag tracking remain. Fresh temporal tests pass; prior PG17 cursor/recovery/short-SLA tests reviewed. A1 is a missing upgrade/tenant-isolation case. |
| 11–13: queue health, typed outcomes, Operations | PARTIAL | Capacity counts, recipient-delay subset and oldest deferred time are separate; queue truncation returns unknown rather than false healthy. A4 remains. Worker metrics miss an exact Operations invocation-ID link (prior C finding). Chain admission failures with no execution remain in generic terminal-delivery totals rather than a dedicated safety count. |
| 14: resource accounting | PASS by inspection and fresh tests | Nonmatches consume new-execution capacity; duplicate receipts and dry run do not. Stale steps consume the established action budget. Retried leases consume claim/retry capacity; capacity rollback refunds failure attempts. Temporal discovery creates events before execution admission. Fixed-window boundary bursts and conservative retry reservations are documented. |
| 15: bulk ticket work | PASS at tested database boundary | Fresh 100-ticket mutation/capture/backlog/drain test; ordinary mutations have no Automation command context and bypass these notification quotas. This is not a fresh browser bulk-operation audit. |
| 16–17: retries/chains | PASS for tested correctness; stress coverage PARTIAL | Depth <8, 32 executions, 100 action attempts and eight delivery attempts remain. The existing terminal trigger closes running executions on both retry acknowledgement and expired-final-lease reaping; suspected missing cleanup was ruled out. Fresh suite includes receipts and exhaustion. Fresh/retry preference applies within the first 100 candidates; sustained retry-heavy traffic beyond that sample needs coverage. |
| 18–20: import/templates/dry run | PASS for current valid definitions | All six templates fit when required references are explicitly completed; disabled imports share create validation; structural/destination checks and zero-write dry run pass fresh. Legacy version dry-run byte-limit handling is not an upgrade compatibility guarantee. |
| 21–22: storage/indexes | PARTIAL | No destructive retention. Two schedule indexes and capacity PK support new access patterns; delivery/trigger indexes are reused. Prior C has row/index-growth samples and representative migration locks. Current production-sized EXPLAIN/BUFFERS, sustained vacuum/bloat and hosted resource measurements remain open. No production queries were made. |
| 23–24: defaults/fail-safe | PASS within the fixed-policy design | No administrator-configurable ceilings; malformed/unset environment flag is OFF. Fresh malformed execution-policy tests preserve queued work. The policy is fixed SQL, not a general runtime configuration system; no claim of exhaustive malformed-policy testing for every key. |
| 25–26: security/audit | PASS for reviewed boundaries | New private tables have RLS and grants revoked, helpers use constrained worker paths, accounting is tenant scoped, and ordinary users cannot mutate counters. Fresh authorization/tenant/MFA tests pass; prior real GoTrue/PostgREST evidence reviewed. No per-defer audit spam introduced. Not a new hosted penetration test. |
| 27–28: UI/accessibility | PARTIAL / screen reader BLOCKED | Builder/error feedback and Operations reuse existing components/tokens; fresh component tests pass. Existing partial browser checks do not establish the full responsive/keyboard/200%/reduced-motion matrix. No new VoiceOver session was started; it remains off. |
| 29–30: tests/stress | PARTIAL | Fresh 707/707 suite passes but misses A1/A2/A4. New manual audit reproducers demonstrate those failures and A3. Prior sustained workload failed and its planned overload phase was not completed. Safety ceilings are not demonstrated throughput. |
| 31–32: migration/production isolation | PARTIAL migration compatibility; isolation PASS | Fresh PG17 39→40 upgrade accepts the legacy rows and preserves OFF, but operational recovery fails A1/A2. No migration changes, remote access, deployment or prepared-backup access. No billable resources created. |

## Fresh verification and reproducibility

Node **24.21.0**, unchanged application code:

| Check | Actual result |
| --- | --- |
| Full application suite | **707 passed**, zero failures/cancellations/skips; 22.116 seconds |
| Typecheck | PASS |
| ESLint `--max-warnings=0` | PASS, including new audit helpers |
| Production build | PASS; `AUTOMATION_PROCESSING_ENABLED=false`; Supabase URL overridden to loopback with non-secret placeholder keys |
| Diff whitespace check | PASS |
| New PGlite probes | Reproduce A1–A4; final processing OFF |
| Native Supabase PostgreSQL 17.11 probes | Reproduce A1/A2; final processing OFF |

Run the historical helpers against the original 40-migration baseline identified
above. The corrected 41-migration tree intentionally no longer exhibits those
failures; its regression suite is the appropriate current release check.

The helpers are **bug reproducers**, not passing correctness tests. Their assertions
expect the current defective behavior; do not move those assertions into the
ordinary suite as requirements. Corrective work must invert them into regressions
that assert the desired behavior.

- `tests/helpers/automation-stage12-audit.mjs` replays migrations into disposable
  in-memory PGlite, seeds the oversized rule before Stage 12, and rolls back each
  isolated probe. Run with Node 24 from the repository root.
- `tests/helpers/automation-stage12-audit-native.mjs` generates synthetic SQL only;
  redirect stdout to a temporary file. It accepts no connection or credential.
  Execute it only against a fresh disposable local PostgreSQL database.

Native execution used the cached image
`public.ecr.aws/supabase/postgres:17.11.0.002`, a newly initialized cluster,
`--network none`, no host ports, no mounted existing volumes and the test-only
Auth/Storage/Realtime substrate. `pg_cron` was preloaded with its automatic jobs
disabled and logical WAL enabled. The first disposable setup omitted that preload
and stopped at the earlier cron migration; it was discarded and replayed from
empty with the correct substrate. No migration was edited or history repaired.
This checks real PG17 behavior, **not** deployed Auth/PostgREST or actual cron.

All native audit processing was returned OFF before stopping/removing the
volume-free container. Previous Stage 12B/C stacks and data volumes were untouched.
Production state was deliberately not queried; its required OFF invariant was
not changed. No browser or screen-reader operations were performed in this audit.

Ephemeral full logs are under `/tmp/fixxflow-stage12-audit-*`; the committed-candidate
JSON evidence preserves sanitized results and hashes of the migration/reproducers.

## Corrections required before another release decision

1. Resolve legacy definition compatibility and safe disable/archive first. Add
   PG17 clean/upgrade/restore regressions with a previously valid oversized rule,
   including pending work and immutable history.
2. Prove a rule-local problem cannot repeatedly stop other tenants' discovery.
   Preserve explicit failure visibility and durable work; do not silently drop it.
3. Correct bounded worker utilization, then repeat the default-cadence sustained
   mixed workload, retry-heavy scenarios, overload and drain. Establish a supported
   workload envelope from measurements before proposing any cadence/batch change.
4. Align Operations/history guardrail classification and add cross-view tests.
5. Complete the remaining responsive, keyboard and real screen-reader gates and
   deployment-specific verification. Local Docker results do not demonstrate
   Vercel's actual scheduled invocations or hosted deployment/auth behavior.

No runtime fixes were made during this audit. New files are this report, its JSON
evidence and the two audit helpers. The guardrails document links these confirmed
defects so its original design claims are not mistaken for current approval.
The separate, pre-existing rollout/Stage 12C
changes remain intact. These findings support scoped corrective work within
Stage 12; they do not support production activation yet.
