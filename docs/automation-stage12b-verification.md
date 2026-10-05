# Automation Stage 12B verification

Verification started 2026-10-02 against `bd4cd42` (clean tree, 40 migrations;
latest `20261002202406_automation_guardrails.sql`). This is verification and release
preparation only. Production database, deployment, credentials and prepared backup
are out of scope and must remain untouched. Processing must remain OFF outside
controlled isolated tests.

## Environment and evidence boundaries

Management inventory found only production FixxFlow and an unrelated project; no
FixxFlow development branches. The owner confirmed no hosted staging environment
exists. No billable infrastructure has been created. A disposable local Supabase
stack was created under `/tmp/fixxflow-stage12b-local`, project identifier
`fixxflow-stage12b-local`, with PostgreSQL major version 17, localhost Auth/PostgREST
and captured test email. It has no production project link or copied environment
files. Only synthetic `example.invalid` identities may be seeded.

Local Supabase evidence cannot establish hosted deployment latency, resource
headroom, cron reliability or production throughput. Direct SQL evidence cannot
establish PostgREST/session authorization. AX inspection cannot substitute for a
VoiceOver/NVDA audit. Each gate below must retain these distinctions.

## Acceptance criteria fixed before capacity measurement

Use the unmodified default worker repository (five deliveries per invocation,
120-second lease, 45-second cooperative budget) and discovery (five rules by
100 tickets, 20-second budget). Do not increase limits or cadence.

- Correctness: zero missing durable events; zero duplicate successful action
  effects; capacity deferral leaves failure attempts unchanged; tenant accounting
  and reads remain isolated; failed/exhausted work remains distinct from capacity.
- Default-cadence smoke: invoke every 60 seconds. Start with two tenants, one
  nonmutating action per event, four events per minute total for three intervals;
  each tenant progresses in each interval and the final actionable queue is empty.
  This is a short smoke measurement, not a sustained production capacity claim.
- Burst/recovery: enqueue 12 events for a large tenant and two for a small tenant;
  the small tenant progresses in the first two invocations and all 14 complete
  within four default invocations (three minutes from first claim), with no loss.
- Saturation: bound inputs and report actual admission/deferral and recovery;
  separately test execution-heavy, notification-heavy and retry-heavy workloads.
  Artificially aged windows/leases are correctness tests, never throughput data.
- Temporal: retain five-by-100 bound and cursor/idempotency, observe lag and missed
  windows; compare arrivals with completions. Default maximum claim opportunity is
  five deliveries/minute platform-wide versus up to 500 temporal events/minute.
  Any growing queue at the tested arrival rate fails a sustainable-load assertion.
- Capture elapsed/action latency, per-tenant completion, oldest actionable age,
  queue drain, capacity counts/duration, relation/index size and available lock
  observations. Record missing metrics as unmeasured. No extrapolation of safety
  ceilings into achieved throughput.
- Migration upgrade: preserve a seeded pre-Stage-12 organization with 101 enabled
  rules, versions/history and processing OFF; reject another enable without
  disabling existing rules. Assess locking with explicitly reported row counts.
- Restore: use only a newly generated synthetic local backup and separate restore
  target; compare schema/data and OFF state. Hosted restore remains a separate gate.

## Baseline results

Node 24.21.0, Next 16.3.5. Fresh `npm test`: **707 passed**, zero failures/skips
(22.259 s); no discrepancy from Stage 12. `npm run typecheck`,
`npm run lint -- --max-warnings=0`, and `AUTOMATION_PROCESSING_ENABLED=false npm run
build`: **PASS**. Logs are local `/tmp/fixxflow-stage12b-{tests,typecheck,lint,build}.log`.
No production requests were made to obtain this baseline.

## Release gates — 2026-10-02

**Stage 12B is not a release or activation approval.** PASS below is limited to the
explicit evidence scope. Hosted deployment gates remain BLOCKED. The machine-readable
[evidence record](automation-stage12b-evidence.json) includes results, measurements
and SHA-256 hashes for all 40 unchanged migrations.

| Gate | Result | Evidence and remaining scope |
| --- | --- | --- |
| Node 24 tests, typecheck, lint, build | PASS | Final full suite 707/707, no skips (23.385 s); typecheck, zero-warning lint and processing-OFF build pass. Seven Operations tests also pass after the copy regression assertion. |
| Supabase PostgreSQL 17 clean replay | PASS, local | CLI 2.119.0, actual Supabase `postgres:17.11.0.002`, server 17.11; all 40 files replayed unchanged. Auth, PostgREST and other local services healthy. |
| Pre-Stage-12 upgrade | PASS, local | Separate stack replayed 39 files, then CLI applied only Stage 12. 101 enabled rules survive; another enable fails. Rules, immutable versions, execution/step/message digests and OFF state unchanged. 2,000 tickets/events/deliveries. |
| Representative migration locking | BLOCKED | Pilot had only one execution/step, not representative constraint volume. Total migration command 4.850 s includes a deliberately held four-second reader lock and CLI overhead. Polling failed to capture the wait; no lock-duration claim. Large-table scans, locks and index plans still required. |
| PostgREST | PASS for tested RPC boundaries; deployed app BLOCKED | Real local HTTP sessions exercise lifecycle, revision conflicts, structural rejection, disabled creation and dry-run reads. No deployed Next application/server-action or import browser flow was available. Existing import/template tests pass in the full suite. |
| Authorization, MFA and tenant isolation | PASS for local matrix | GoTrue TOTP enrollment/challenge produces AAL2; fresh AAL1 session denied. Technician, employee, insufficient-MFA administrator and other-tenant administrator denied rule creation, reference reads, dry-run, history and Operations. RLS rule reads isolated; worker claim RPC denied to ordinary sessions. Hosted/session-cookie routes remain unverified. |
| Independent concurrency | PASS, local | Independent HTTP requests race at 99 active rules, 119 execution admissions, 19 recipient notifications and 119 tenant notifications. Exactly one final slot is admitted in each race. Independent SQL lock holder overlaps HTTP action requests; one committed action attempt. |
| Tenant fairness and capacity deferral | PASS, bounded local | Large/small tenant burst and 210-versus-one temporal workload both show small-tenant progress. FF002/FF003 preserve deferred work and refund failure attempts; recovery completes without repeating receipts. This does not prove hours-long fairness under arbitrary tenant counts. |
| Sustainable throughput/backlog recovery | BLOCKED for release capacity | Short local default-cadence smoke passes at four deliveries/minute; 14-event burst drains in 120.511 s. Hosted arrivals, latency, resource headroom and hours-long mixed workloads are unmeasured. |
| Worker/discovery end-to-end | PASS for local repository → PostgREST → DB; hosted cron BLOCKED | Actual worker repository, telemetry wrapper and scheduler adapter used. Temporal batches emit 101, 100, 10, 0; 211 unique occurrences. Rollback/cursor recovery, duplicate suppression and smaller-tenant note pass. No deployed cron invocation/hosting timeout proof. |
| Failure recovery and kill switches | PASS for bounded local cases; full operational gate BLOCKED | Expired-lease fixture rotates token, old token denied, completed action stays at one attempt. Eighth-attempt retry terminalizes running execution. Environment OFF skips claim; database OFF prevents claims/discovery, retains data. Automated suite covers terminal/retry failure and reactivation cutoffs. Actual process termination, network outage and full eight-attempt wall-clock recovery still need staging. |
| Notification protection | PASS, local | Tenant/recipient contention, duplicate receipts, transaction rollback, defer/refund/resume pass. No external email dispatcher/provider was run. Synthetic recipients use `example.invalid`; Auth email is captured by local Mailpit. External email delivery is unmeasured and is not exactly-once. |
| Responsive, keyboard, screen reader | BLOCKED overall | Synthetic real-component Safari preview: 390px stacking visually inspected; 768px viewport/semantic table transition inspected via AX; desktop Tab/Space disclosure and retained focus verified. Capacity, notification delay, failure and exhaustion have distinct text. Full builder/enable/import/history/error-state matrix and desktop/tablet/mobile screenshots remain open. VoiceOver launch timed out and subsequent inventory showed it not running; no spoken-output audit completed. |
| Observability | PASS for local trace/log checks; hosted monitoring BLOCKED | Worker log has event/delivery/rule/version/execution/step/correlation identifiers. Allowlist check rejects note content, definitions, passwords and tokens. Operations tests verify sanitized platform heartbeat and tenant-only counts. No hosted log pipeline, alert routing or performance dashboard verified. |
| Isolated restore rehearsal | PASS for local logical application recovery; hosted restore BLOCKED | Separate third Supabase stack restored synthetic CLI schema/data/history; row digests match across 49 tables total, covering application/history tables and Auth users. 17 Storage/Realtime application policies restored separately and compared. Both excluded managed vector tables were verified empty. OFF, 40 migration entries, 101 enabled rules, 2,000 tickets retained. No hosted settings, Storage object bytes or PITR restoration tested. |

## Measured capacity and bottlenecks

The workload used the unmodified worker repository: five deliveries per invocation,
120-second leases, 45-second budget; invocations started 60 seconds apart. Each
input matched one nonmutating internal-note rule. There were no dependency failures
or notification fanout in this timed workload. PostgreSQL, PostgREST and Node ran
on this development machine; another isolated migration/restore stack shared its
Docker resources. These are local smoke results, not a commercial service level.

- Steady: three arrivals/minute for tenant A plus one/minute for tenant B, for
  three intervals (180 s). Twelve arrivals and twelve acknowledged deliveries;
  every invocation completed four, with no actionable backlog afterward.
- Burst: twelve A plus two B deliveries. Default batches completed **5, 5, 4**;
  backlog **9, 4, 0**. Both B deliveries completed by the second invocation.
  Drain time **120.511 s**. Oldest pending work after the second batch was
  **60.472 s**. No capacity deferrals, retries or failures in this timed smoke.
- Twenty-six actions: HTTP command latency median **6.412 ms**, p95 **10.568 ms**,
  maximum **11.313 ms**. This includes local PostgREST round trip, not external
  email or hosted network latency. All 26 successful note effects were unique.
- Separate temporal probe: 210 tickets in one tenant and one in another; emitted
  211 occurrences across three discovery invocations. Observed discovery lag
  **0.124–0.300 s** with deliberately aged thresholds. These are correctness
  fixtures; no real-time short approaching-SLA window capacity was demonstrated.
- Following temporal discovery, three default worker calls acknowledged **1, 1,
  2** deliveries. Ineligible ordinary ticket events consume bounded inspection
  slots before temporal deliveries. This demonstrates utilization below the
  nominal five-delivery batch under a mixed queue, without starvation in the
  small-tenant probe. No batches/cadence/ceilings were raised to hide this effect.
- The existing upper bounds still disagree sharply: at most **5 delivery claims
  per scheduled minute platform-wide** versus up to **500 generated temporal
  events per discovery invocation**. Even without other arrivals, a full temporal
  batch requires at least 100 default worker invocations to drain. No sustained
  saturation benchmark or cadence change was performed. A separate capacity
  proposal needs measured hosted backlog, latency and lock evidence.

Physical relation growth during the smoke (including setup revisions; not pure
per-event cost): events +57,344 B; deliveries +8,192 B; executions +122,880 B;
steps +57,344 B; worker runs +40,960 B; note messages +81,920 B. Index growth was
included in these totals (execution indexes +81,920 B; step indexes +49,152 B).
Small heaps/indexes allocate pages unevenly; do not extrapolate these byte ratios.
`pg_stat_user_tables.n_live_tup` in raw evidence is approximate and lagged the last
batch; exact effect/execution assertions established 26 completions. A later idle
spot sample showed PostgreSQL 184.3 MiB / 0.29% CPU, PostgREST 160.1 MiB / 0.17%,
Auth 20.73 MiB / 0.03%. These are not peak or sustained resource measurements.

Retry-heavy/notification-heavy throughput, long-duration fairness, lock-wait
percentiles, vacuum/index growth and missed approaching windows remain unmeasured.
Their deterministic correctness coverage passed, including independent notification
contention; that coverage must not be labelled a load benchmark.

## Defects, corrections and evidence limitations

1. **Product copy corrected:** Operations said all deferred work makes service
   health degraded. Runtime correctly excludes capacity-only deferral. The text
   now distinguishes interrupted work from capacity delay, with the latter shown
   in the delivery queue. Existing capacity UI regression assertion extended.
   No runtime contract, limit, cadence, schema or migration changed.
2. **Restore procedure corrected:** generic full `pg_restore` first failed on
   `supabase_admin` ownership, then on `pg_cron` being bound to database `postgres`.
   A separate Supabase stack and the official CLI export procedure succeeded.
   Managed vector-table data must be excluded as documented (both empty here);
   the app's 17 custom Storage/Realtime policies must be exported/restored
   separately. A data-only restore uses replica mode transactionally because
   Automation provenance has circular FKs; source/target row and policy digests
   are checked afterward. No constraint or migration history was repaired.
3. **Harness corrections:** composite RPC results are objects, not arrays;
   expired-lease fixtures must update availability to exactly equal lease expiry.
   The database correctly rejected the invalid fixture. Corrected probes pass.
4. **Environment interruption:** Docker stopped after clean replay. After the
   owner's instruction to restart it, work resumed with existing disposable data.
   No hosted project was substituted. VoiceOver remained unavailable to this run.

The correction reuses existing Operations `details`/`summary`, cards, text and
semantic tokens. No new UI component, library, design token, live region or
`DESIGN_SYSTEM.md` exception was introduced. Keyboard/AX checks are partial and
are not a full accessibility compliance claim.

## Reproduction and recovery notes

The seven `tests/helpers/automation-stage12b-*.mjs` scripts are manual probes,
not ordinary CI tests. They require fixed disposable local project/container names
and reject other API/database hosts; they never load repository `.env` files.
Use Node 24. Scripts emit safe result codes and metrics. Local API/session material
stays in memory or a mode-0600 temporary credential file; never commit it.

1. Create `/tmp/fixxflow-stage12b-local/supabase/config.toml` from local config with
   project ID `fixxflow-stage12b-local`, local-only auth redirects, no seed, no
   external provider credentials; copy the exact 40 migrations. Start the stack
   with captured email and verify the container identity/PG17 ledger before writes.
2. Run `automation-stage12b-postgrest.mjs`, then `automation-stage12b-capacity.mjs`,
   then `automation-stage12b-contention.mjs`, then `automation-stage12b-temporal.mjs`.
   Fresh stacks avoid leftover fixture queues influencing later measurements.
   Contention/temporal probes age test windows/leases; the cadence probe does not.
3. Prepare `fixxflow-stage12b-upgrade` with separate ports and exactly the first
   39 migrations. Run `automation-stage12b-upgrade.mjs`; it adds/applies only the
   unchanged Stage 12 file with `migration up --local`. Do not rerun against a
   completed upgrade or alter migration history to satisfy its 39-entry guard.
4. Use `supabase db dump --local --workdir /tmp/fixxflow-stage12b-upgrade` to export
   schema, data (`--data-only --use-copy -x storage.buckets_vectors -x
   storage.vector_indexes`), and separate `--schema supabase_migrations` schema/data.
   Create the empty third stack `fixxflow-stage12b-restore`, on separate ports.
   `automation-stage12b-restore.mjs` restores into its `postgres` database,
   exports/adds custom managed-schema policies and compares all rows/policies.
   Its narrowly guarded `--complete-managed-policies` flag was used once to
   complete the initial rehearsal target after detecting the omitted policies.
5. Verify processing OFF in every local database; retain safe evidence, stop
   test services. Never use the prepared production backup for these probes.

The restore workflow follows [Supabase's CLI backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
including the separate migration ledger and managed-schema modifications. Schema
and data dumps contain synthetic data and are retained only under `/tmp` with
restricted permissions. This rehearsal does not test restoring a hosted backup.

For diagnosis, follow event → delivery → pinned rule/version → execution → ordered
step, using correlation ID to follow a chain. **Capacity delay:** inspect the safe
capacity reason, availability and oldest delay; do not consume retries or manually
clear receipts. **Action failure:** inspect the terminal step's allowlisted code
and revision/authorization context. **Retry exhaustion:** delivery is dead and
associated execution failed/partially completed; preserve completed receipts and
investigate the dependency. OFF stops new automated actions, retains records and
uses established activation/version cutoffs on re-enable; old unadmitted backlog
is not automatically replayed. Temporal probe backlog was preserved, not deleted.

No retention deletion was added. Keep the Stage 12 storage recommendations:
never delete pending/leased/deferred work; retain interconnected provenance,
deduplication and immutable versions/history together. Capacity tests do not
resolve long-term storage growth or establish safe retention windows.

## Outstanding release blockers and deployment sequence

There is no hosted staging project/deployment; the owner confirmed this. Provision
one only after a separate organization-specific cost quote and explicit approval.
Use separate secrets, synthetic users and a test-only email sink. Then complete
deployed app/server-action/import flows, real cron and interruption tests,
representative migration/constraint locking, hours-long mixed workloads, short SLA
windows, full responsive/keyboard/VoiceOver or NVDA audit, hosted observability,
and hosted recovery/configuration/Storage restoration. The current evidence
**does not support production activation** or claim Stage 12B complete. It supports
preparing the isolated hosted validation environment and its test plan.

Recommended later deployment, under separate authorization:

1. Resolve the release gates and review the measured capacity plan. Verify target
   identity, current ledger, recoverable backup and maintenance window. Do not
   infer the production ledger from this local 40-file replay.
2. Keep both deployment processing flag and database owner control OFF. Apply only
   genuinely pending reviewed migrations in order; enum additions retain their
   separate-commit boundary. Stop on unexpected divergence; do not repair history.
3. Read back the expected ledger, preserved legacy rules/history and OFF state.
   Deploy the verified application with `AUTOMATION_PROCESSING_ENABLED=false`.
4. Smoke-test administration, ticket mutations, auth/MFA, Operations, and no new
   automated actions. Monitor database constraints/locks and backlog visibility.
5. Stop with processing OFF. Prepare a separate controlled activation request only
   after hosted capacity, fairness, recovery, accessibility and observability gates
   pass, with defined workload limits, rollback/kill-switch triggers and an owner.

No deployment, production DB query/migration, production credential change or
production-backup access occurred. Supabase management inventory only was used to
identify the absence of a staging project/branch. Final local processing state was
read back as **false in all three stacks**. All three local Supabase stacks were
then stopped with data volumes preserved; the synthetic UI server was also stopped.

## Files changed

- `src/features/automation/operations-view.tsx`: correct capacity health explanation.
- `src/features/automation/operations-ui.test.mjs`: extend existing copy regression check.
- `docs/automation-guardrails.md`: link current Stage 12B evidence.
- `docs/automation-stage12b-verification.md` and `automation-stage12b-evidence.json`:
  gate report, measurements, migration hashes and deployment preparation.
- Seven `tests/helpers/automation-stage12b-*.mjs` manual local probes: identity
  guard/client, PostgREST, capacity, contention, temporal, upgrade and restore.

**No migration files, runtime limits, dependencies, production configuration or
unrelated files changed.** No commit, remote push or deployment performed.
