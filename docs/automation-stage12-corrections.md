# Stage 12 corrective implementation and verification

All four confirmed audit defects are corrected and local corrective verification
passed on 2026-10-03 UTC. This report supersedes the implementation status of
A1–A4 in the [historical audit](automation-stage12-audit.md), not the remaining
hosted/accessibility gates in [Stage 12C](automation-stage12c-verification.md).
Production was not accessed, changed, deployed or activated. No paid resources,
production credentials or prepared production backup were used.

## Tested candidate and scope

Base commit: `048a16280310b65838192d5ac1aef8100a5bd6bc`. The corrections are an
**uncommitted working-tree candidate**, not that unchanged commit. The evidence
manifest records its file hashes: [machine-readable evidence](automation-stage12-corrections-evidence.json). Existing Stage 12C files and unrelated changes
are preserved. Node **24.21.0**; native database image
`public.ecr.aws/supabase/postgres:17.11.0.002` (**PostgreSQL 17.11**).

There are **41 migrations**; the only new one is
`20261003005804_automation_guardrails_corrections.sql`. The original 40 are
unchanged. No triggers, conditions, actions, integration, subscription or billing
capabilities are added. Safety ceilings, worker batch five, minute cadence,
processing generations, tenant/MFA authority, chain limits and retry semantics
remain unchanged.

## Corrections

| Finding | Corrected behavior | Regression evidence |
| --- | --- | --- |
| A1: legacy temporal definition rolls back shared discovery | Runtime validates persisted definitions against their original structural bounds; the later byte policy remains a write boundary. The same shared planner is used, with no blanket exception swallowing or silent rule disable. | A genuinely pre-upgrade 270,665-byte temporal definition and another tenant both discover and execute on PG17; cursors and deduplication persist. |
| A2: legacy rule cannot disable/archive | Stored-definition CHECK retains Stage 1–11 bounds. RPCs and a separate trigger enforce 256 KiB on create/edit/reenable. Reads and immutable execution/version views accept valid legacy data. Dry run reports the current size limit explicitly. | Disable/archive pass; create/edit/duplicate/reenable above the byte ceiling fail; shrinking then enabling passes. Immutable versions remain unchanged. Logical restore check recorded below. |
| A3: empty tenant visits waste claim slots | Successful leases have a separate budget from inspection. Each invocation visits at most 20 tenants, examines at most 100 cheap IDs per visit and performs at most batch × 100 eligibility checks. Exhausted tenants are excluded for the invocation. | The original 20-event/four-worker-call reproduction now completes all 20. Tests cover a 240-event ineligible prefix, 30 inactive tenants, and 120 retries ahead of fresh work. Real-cadence workload recorded below. |
| A4: history misclassifies safety outcomes | Safety-limit history filter is distinct; Action failed excludes chain/fanout outcomes consistently with Operations. | An actual notification fanout termination agrees across overview and all history filters. |

Two related audit gaps are also closed: terminal chain admission without an
execution has its own delivery outcome count, and worker/discovery logs link to
the Operations invocation identity. Logging remains limited to safe identifiers,
counts and typed results. No message bodies or credentials are added.

### Additional recovery finding: transaction markers do not survive logical relocation

A new cross-cluster probe found source transaction ID 1355 versus target 742.
A normal byte-for-byte logical restore left a fresh ticket ineligible because the
saved version's transaction marker belonged to the source cluster. This is a
pre-existing recovery problem exposed while closing Stage 12's restore gate;
previous row-digest comparisons did not test it. PostgreSQL assigns these IDs
[from a cluster-wide counter](https://www.postgresql.org/docs/17/transaction-id.html).

The corrected **logical restore procedure**, not a runtime eligibility bypass,
excludes only the data of `private.automation_version_visibility` and rebuilds
that derived metadata before restoring post-data guards. This uses the same
initialization semantics as Stage 4's seeding of pre-existing versions. Original
markers remain in the unmodified complete backup. Public rule versions, events,
source snapshots, executions and steps are not rewritten. Normal installed-schema
immutability remains enforced.

The [restore-only SQL](sql/automation-logical-restore-visibility.sql) refuses active
processing, nonempty marker data, or an already guarded schema. Native PG17 checks
prove: fresh canary admission/action after new activation, duplicate receipt
protection, old pending-event exclusion, unchanged immutable versions and restored
append-only guards. Both targets finish OFF. Do not apply this procedure to a
physical/PITR restore that preserves the cluster's transaction history, nor to a
live installation. Managed-provider permissions and recovery procedures still
need their own rehearsal.

## Verification gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Full Node 24 suite | PASS | **724 tests**, no failures, cancellations or skips; 11.354 seconds. Original 707 retained, 17 added. |
| Typecheck | PASS | Repository `npm run typecheck`. |
| ESLint | PASS | `npm run lint -- --max-warnings=0`. |
| Production build | PASS | Node 24, environment processing OFF; Supabase URL explicitly loopback and actual publishable/secret key variables set to synthetic placeholders. No deployment. |
| PG17 clean replay | PASS | All 41 migrations in a fresh empty cluster; processing OFF; private helper grants and RLS checked. |
| PG17 legacy upgrade | PASS | Pre-Stage-12 data: 4,000 rules, 101 enabled, including oversized valid definitions. Rule/version/processing digests match after both migrations. Further enable denied. |
| Migration locks | PASS, local scope | A held rule-table reader blocks migration; 300 ms lock timeout aborts and rolls back all correction changes. Successful correction takes 6.190 seconds. 61 simultaneous ticket writes: p95 53.8 ms, maximum 55.6 ms. |
| Independent concurrency | PASS, local SQL | Separate connections: active limit 100, execution 120, recipient notification 20, tenant notification 120; rejected action remains zero attempts, deferred delivery refunds its failure attempt. Overlapping leases remain unique; duplicate action returns existing receipt. |
| Legacy worker/discovery recovery | PASS, local SQL + actual worker | Five completed legacy notes are not repeated on recovery; a legacy temporal rule does not stop the other tenant. Real one-minute threshold on PG17, not a changed clock. |
| Sustained capacity/fairness | PASS, local scope | 60 real minutes, 253 steady deliveries (4.217/min), zero pending at every post-invocation sample. A 20-ticket burst plus one temporal event drains in five one-minute invocations. All eight tenants progress; no failures or retries. |
| Restore transaction provenance | PASS, native PG17 | A complete raw logical restore reproduces fresh-event rejection; rebuilding only derived visibility metadata in an empty target restores eligibility, deduplication and immutability, with old queued events excluded. |
| Logical backup/restore | PASS, native PG17 | New synthetic 992,553-byte backup restores in 475 ms. Rule/version/execution/step/event/delivery and processing-state digests match; both oversized legacy rules survive and the CHECK remains validated. Source/target processing OFF. |
| Operations presentation | PASS, component/database scope | Native labeled filter, persisted selection/cursor links, distinct safety/delay/failure/exhaustion text and semantic metrics. No polling/live-region noise added. |
| Claim query/index review | PASS, local scope | 10,000 synthetic deliveries (9,000 historical in one tenant, 1,000 actionable in another). Default claim returned five in 8.718 ms; bounded candidate plan 0.359 ms. Existing pending-tenant index selects 100 candidates; optimizer rejoined through the existing tenant/key index. These are query timings, not sustained throughput. |
| Local database advisor | PASS with existing warnings | CLI 2.119, explicit loopback URL. No ERRORs. WARNs: existing assets RLS initialization, existing ticket UPDATE policies, and test-substrate cron extension placement. No new correction-object warning. Not a hosted advisor run. |
| Local PostgREST corrections | PASS | Real PostgREST 16.4: legacy repository reads/versions and disable/archive, strict byte errors, dry-run zero side effects, tenant/role/MFA-claim denial, and actual worker safety outcome/history consistency. Signed synthetic JWT and MFA-factor fixtures; no GoTrue login/TOTP or deployed Next SSR claim. |
| Hosted app/actual cron | BLOCKED / not rerun | These checks use actual PG17 and the actual TypeScript worker through independent SQL RPC sessions. They do not replace deployed HTTP/Auth/MFA/cron. Existing local Stage12B/C results remain historical evidence. |
| Full responsive/keyboard/screen reader | BLOCKED / not claimed | Scoped component checks pass. The full browser/200%/reduced-motion and real VoiceOver/NVDA matrix remains open. VoiceOver was not enabled. |

## Workload defined before execution

- Eight new synthetic tenants, plus retained historical ineligible work. Large
  tenant receives 60% of ordinary arrivals; remaining seven share the rest.
- Sixty one-minute arrival batches, four tickets each. Every tenant has a matching
  and a nonmatching rule. Alternating tenants use internal notes or explicit
  requester notifications. One small tenant also has a one-minute temporal rule.
- One default discovery and worker invocation per real minute; no limits, cadence,
  clocks or lease timestamps raised to improve results. Separate deterministic and
  native contention tests exercise retries, saturation and overlapping workers.
- After steady work, wait one cadence and require zero pending work; then inject
  20 tickets across all eight tenants and allow at most ten scheduled calls to drain.
- Stop on an action/delivery failure, retry, dead delivery, 200 pending records or
  steady actionable age reaching 180 seconds. Every tenant must progress; all burst
  work must acknowledge. Always switch the isolated database OFF in `finally`.
- Results concern this local workload only. SQL process transport includes Docker
  and connection overhead; it is neither hosted HTTP capacity nor actual cron.
  This run does not establish multi-hour retry-heavy or short-SLA service guarantees.

The original 12C result (4.206 arrivals/min, 3.411 completions/min and a growing
backlog) is retained as a failed baseline, not relabeled as passing. The remaining
architecture bottleneck is unchanged: at most five default delivery claims/minute
platform-wide versus up to 500 temporal events per discovery invocation. Safety
ceilings are not demonstrated throughput or a commercial service promise.

### Measured result and limits

The run lasted from 01:17 to 02:22 UTC on 2026-10-03. It completed **274**
deliveries: 240 ordinary plus 13 temporal during the steady phase, then 20 ordinary
plus one temporal in the burst. The large tenant completed 157; the small tenants
completed 14–28 each. Post-invocation steady backlog and actionable age were zero;
this does not mean zero waiting between scheduled invocations. During burst drain,
the largest post-invocation backlog was 15 and oldest actionable age 241.1 seconds.
All 21 burst deliveries completed within five scheduled intervals. The longest
combined discovery/worker cycle was 8.443 seconds. No delivery failed, retried,
exhausted or deferred for capacity in this workload; independent saturation tests
provide capacity-deferral and retry evidence, not this unsaturated run.

The final database snapshot includes earlier verification fixtures as well as the
workload: 288 successful executions, persisted execution duration p50 39 ms,
p95 190.7 ms and maximum 364 ms. These are execution durations, not separately
instrumented action latency. No lock waiter existed at the final snapshot and no
database deadlock was recorded; lock waits were not continuously sampled.
Comparable selected operational tables/indexes grew from 1,638,400 to 2,752,512
bytes between 01:42 and 02:22 UTC (+1,114,112 bytes). Including the additional
empty invocation table, final selected storage was 2,793,472 bytes. This is neither
whole-database storage nor a long-term bloat estimate. CPU/memory headroom and
multi-hour retry-heavy/short-SLA behavior remain unmeasured. The direct worker
harness bypasses the HTTP telemetry wrapper, so zero invocation rows here are not
an end-to-end invocation-observability result.

Processing was read back **OFF** after the workload and before backup, and the
restored target was **OFF**. Disposable correction containers are removed after
verification; pre-existing Docker volumes and the prepared production backup are
untouched. The synthetic backup is local temporary test data only, not a production
recovery artifact.

## Migration and restore procedure

The correction is transactional and does not activate processing or rewrite
saved data. Its validated CHECK requires an exclusive rule-table lock until
commit. The local timing supports a short planned Automation administration pause;
it does not justify a claim of zero production blocking. Use a bounded lock timeout,
inspect contention and abort/retry during the approved window. Ordinary ticket
writes continued in the synthetic test. No new index is introduced.

Full logical restore must recreate schema/functions, data, target-cluster visibility
metadata and post-data triggers in order, into a separate empty target with required roles/extensions. The new
write trigger deliberately rejects new oversized data, while the stored-definition
CHECK accepts previously valid rows during normal full restoration. Data-only
restore into an already triggered schema requires a separately reviewed procedure.
Do not drop constraints or weaken client grants as a recovery shortcut.

The local test substrate supplies minimal Auth/Storage/Realtime objects. A complete
managed Supabase restore must also follow the established provider-owned object,
custom policy, Auth/MFA, Storage bytes and hosted configuration procedures. Preserved
row digests alone are not proof of complete application recovery. Keep processing
OFF until post-restore authorization, transaction-provenance and activation checks
pass; do not automatically replay old queued events.

## Reproduction and test-harness corrections

- Ordinary CI includes `guardrails-corrections.test.mjs` with migrated SQL and the
  actual worker. The existing bulk-drain helper now advances only **future** delayed
  availability; rewriting every pending timestamp had invalidated its own durable
  cursor ordering. The 100-event drain assertion is unchanged.
- `automation-stage12-corrections-native.mjs`: `prepare`, `verify`, `workload` use
  only a fixed, newly initialized Docker container. No URL/credential input.
- `automation-stage12-corrections-database.mjs`: `clean`, `upgrade`, `concurrency`,
  `plans`, `advisors`, `restore-provenance`, `restore` create uniquely named disposable targets and stop
  them afterward. Existing containers/volumes are not reset. Advisor alone exposes
  an empty synthetic database on loopback for CLI inspection.
- Early manual adapters mishandled scalar boolean RPC results, split UTF-8 stream
  chunks, and over-assumed that both simultaneous claimants must win. Those harness
  defects were corrected and verification restarted from an empty database. A
  query-plan substitution bug and local TLS mismatch were likewise corrected.
  Docker suppressed published ports on the HTTP test’s internal network; PostgREST
  now uses a loopback-published bridge plus the private database network. No email
  dispatcher exists in this fixture. The temporary signing material is removed
  when its containers stop.
  Failed harness attempts are not counted as passing application checks.

The PostgREST helper `automation-stage12-corrections-postgrest.mjs` uses the
[documented role-switching model](https://docs.postgrest.org/en/stable/explanations/db_authz.html)
and [dedicated JWT configuration](https://docs.postgrest.org/en/stable/references/configuration.html#jwt-secret).
Its token fixtures verify claim enforcement; they are deliberately not presented
as real MFA enrollment/challenge evidence.

## Files changed by the corrections

- Forward migration: `20261003005804_automation_guardrails_corrections.sql`.
- Validation/planning/reads: `validation.ts`, `planner.ts`, `worker.ts`,
  `repository.ts`, `ui-service.ts`, `dry-run-model.ts`, `dry-run-service.ts` and
  `limits.ts` in `src/features/automation`.
- Operations: model, service, view and telemetry; history page; worker and
  discovery cron routes. Existing cards, metrics, badges and labeled native
  filter controls are reused. No new tokens/components or design-system exception.
- Regression tests: new `guardrails-corrections.test.mjs`; updates to guardrails,
  Operations model/telemetry and Operations UI tests. Existing assertions remain.
- Three new manual verification helpers: corrections native worker, database,
  PostgREST; plus the restore-only SQL procedure (the SQL is documentation tooling,
  not a deployment migration). Reports/runbook/guardrails documentation updated.
- Pre-existing Stage12C helpers and evidence are preserved. The audit report gets
  only a historical-status link and reproduction clarification; its original
  findings and evidence are not rewritten as passes.

## Release decision and remaining work

The code corrections do not authorize deployment or activation. Finish the
remaining hosted/actual-cron and accessibility gates, pin the tested candidate,
review migration/backup readiness and agree on a measured workload envelope.
The [updated runbook](automation-rollout.md#stage-12-corrective-release-candidate)
keeps database and application processing OFF through deployment and treats any
later narrowly controlled activation as a separate decision.

No destructive retention is introduced. Pending work, receipts, versions,
provenance and deduplication records retain their existing storage obligations.
Use the existing retention recommendations; longer tests of vacuum/bloat,
resource headroom and hosted queue growth remain operational release work.
