# Automation Stage 12C — hosted staging and release readiness

Status: **Docker verification recorded; Stage12C release/activation BLOCKED**.
The local workload target failed. The remaining gates below are not waived.
This record distinguishes completed evidence from the superseded hosted proposal.
The [sanitized evidence record](automation-stage12c-evidence.json) includes raw local
samples, final control readbacks, migration/helper hashes and verification outcomes.
No hosted infrastructure creation or deployment is authorized yet. Production
Supabase, credentials and the prepared backup have not been accessed or changed.
No production deployment or processing control was changed. Safari occasionally
showed the owner’s existing Vercel window while switching windows; no deployment
action was taken, and browser work stopped when the owner resumed using it.

### Owner-directed Docker continuation

The owner subsequently selected Docker instead of paid staging and asked to move
toward production after verification passes. No paid resources will be created.
Continue the remaining local gates using fresh `fixxflow-stage12c-local` (40 files)
and `fixxflow-stage12c-upgrade` (39 files initially) Docker projects. Preserve the
Stage 12B stacks and backup artifacts. Provider-specific hosted gates remain
unverified; local success does not silently close them. A production deployment
with processing OFF and an eventual controlled activation are distinct decisions.

The local sustained test target is at least 60 minutes at the unchanged 60-second
cadence, followed by a bounded overload/drain phase. Include eight tenants, matching,
nonmatching and notification rules, real temporal thresholds and separate injected
retry/concurrency probes. Record exact achieved workload mix and phases, including
any shortfall from the longer hosted proposal below. This local measurement cannot
establish hosted capacity. The migration volume and correctness criteria below
remain applicable locally. No batch size, safety ceiling or cadence is increased.

## Baseline and completed checks

Baseline: `048a16280310b65838192d5ac1aef8100a5bd6bc` (`stage 12B`), initially
clean working tree. Node `24.21.0`; `.nvmrc` and package engines require Node 24.
There are **40 SQL migrations**, latest
`20261002202406_automation_guardrails.sql`. All 40 file hashes match the
[Stage 12B evidence manifest](automation-stage12b-evidence.json).

Read [Stage 12B verification](automation-stage12b-verification.md) and
[guardrail contracts](automation-guardrails.md). The changes since Stage 12's
`bd4cd42` are the Stage 12B report/evidence/manual helpers and an Operations copy
correction with its test. No migration or runtime guardrail contract changed.
Earlier results remain historical evidence, not fresh hosted results.

Fresh checks against `048a162` on 2026-10-02:

| Command | Result |
| --- | --- |
| `npm test` | PASS: 707 passed; zero failures, cancellations or skips; 21.369 s |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint -- --max-warnings=0` | PASS, exit 0, zero warnings |
| `AUTOMATION_PROCESSING_ENABLED=false npm run build` | PASS, exit 0, Node 24 optimized build |

Local logs: `/tmp/fixxflow-stage12c-{tests,typecheck,lint,build}.log`.
These are ephemeral; preserve sanitized CI logs with a future release record.
Manual verification helpers and this documentation were added after these checks.
No application, dependency, production configuration or migration edits have been
made. The final application suite also passes: 707 tests, zero failures/skips (22.844 s),
typecheck, zero-warning lint and the processing-OFF production build. Remaining
manual-helper edits receive their own direct verification and final lint/diff checks.

Initial controls: local build explicitly OFF. Stage 12B recorded its three
disposable local databases OFF and stopped. Hosted staging does not exist, so its
controls are **not provisioned**, not an observed OFF state. Production OFF is a
required invariant; it has deliberately not been remotely rechecked.

## Superseded hosted proposal — not approved or provisioned

The owner subsequently selected Docker. The quote below is retained as historical
planning evidence; buying this infrastructure is not required to continue local
verification. Hosted behavior remains unmeasured. No new infrastructure cost was incurred.

The owner confirmed there is no suitable existing hosted staging and selected the
existing Supabase organization and Vercel team for the pricing proposal. That
selection authorizes quoting only, not creating resources.

| Resource | Proposed isolation and use |
| --- | --- |
| Supabase `fixxflow-stage12c-staging` | Dedicated PostgreSQL 17 Micro project in `DEVDigitalBVI's Org` (`vucflplqbfwqsfyrgeau`), confirmed Pro by organization metadata. Clean replay, hosted application, synthetic Auth/MFA and workload tests. No production branch, backup or data copy. |
| Supabase `fixxflow-stage12c-disposable` | Separate PostgreSQL 17 Micro project in the same organization. Pre-Stage-12 upgrade/locking tests, then isolated restore rehearsal after preserving evidence and clearing only this disposable test database. Never an application or production restore target. |
| Vercel `fixxflow-automation-staging` | New project in the existing team `team_PxGCCYQl1LuB0sFn0CPFwBz1`; Node 24, unique `vercel.app` domain, isolated environment and no production domains. Do not change the existing `fixx-flow` project or repository's production `.vercel` link. |

Vercel cron calls a project's **Production deployment**, and minute-level schedules
require Pro/Enterprise. The proposed deployment therefore uses that target label
**only within the new staging project**, never FixxFlow's production project.
Confirm the team's plan before deployment. Manual invocations or a Hobby daily
schedule cannot close the cron gate. See [cron deployment behavior](https://vercel.com/docs/cron-jobs)
and [cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Cost quote obtained from Supabase for the owner-selected organization: **$10 per
project per month**, hence **$20/month for two projects** if retained. Published
Micro pricing is $0.01344/hour: two projects for 168 hours cost approximately
**$4.52 compute**, before other usage, taxes and any available shared credits.
Compute is billed hourly and is not protected by the Supabase Spend Cap. No PITR,
larger compute or other paid add-ons are proposed. See [compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute).

The Vercel team's current billing plan could not yet be verified through available
account access. If already Pro, reuse the existing deploying seat; incremental
function/network usage still depends on the team's remaining allowance. If Hobby,
Pro's published base fee is **$20/month** including one deploying seat; an upgrade
requires separate explicit approval. No seat, domain, protection or observability
add-on purchase is proposed. See [Vercel Pro pricing](https://vercel.com/docs/plans/pro-plan).

Proposed initial test lifetime: seven days. Proposed incremental usage stop budget:
**$10 total above existing subscriptions**, including the estimated $4.52 compute,
excluding any separately approved Vercel plan upgrade. This is an operational
monitoring/stop threshold, not a provider-enforced guarantee or fixed-price quote.
Record creation time, spend observations and a cleanup deadline; stop workloads
and request a budget extension before exceeding it. Remove disposable resources
after evidence export and owner-confirmed completion; retaining both adds the
quoted ongoing monthly cost. Disabling Automation alone does not stop database
compute charges.

Before any writes, verify new project IDs/names, owner, region, PG major/minor and
empty migration ledger; keep an explicit staging-only allowlist. Select matching
application/database regions supported by both providers and record them before
provisioning. Production-region equivalence has not been established; do not claim
Micro results represent a differently sized or located production deployment.

Use an isolated checkout without `.env*`, `.vercel` or Supabase production links.
Generate fresh staging-only secrets; configure exact staging Auth site/redirect
URLs and genuine TOTP MFA. Test both environment and owner-controlled database
processing gates starting OFF. Protect cron with a new secret, test unauthorized
requests, and verify actual scheduled invocations of all three configured routes.
Do not copy shared/team production environment values into the new project.

Only synthetic `example.invalid` users/recipients are allowed. Keep Zoho delivery
credentials and sender configuration absent: the notification dispatcher returns
503 before claiming/sending mail. Disable public signups and create confirmed
test users through the staging administrator API; do not invoke real-user Auth
email flows. This verifies inbox/outbox protection but leaves external email
delivery untested. A provider-approved capture configuration is required before
testing email dispatch/redirect links; no live customer delivery is permitted.
Never include secrets, MFA seeds, cookies or message contents in screenshots/logs.

## Acceptance criteria fixed before hosted testing

These are proposed verification targets, not measured service guarantees. Record
the approved infrastructure, deployed commit, PG/Node versions, function region,
compute tier and start/end times alongside every run. Defaults stay unchanged:
five worker deliveries/minute platform-wide, 120-second lease, 45-second worker
budget; discovery five rules by 100 tickets with a 20-second budget every minute.
Do not confuse the 120/tenant/minute execution ceiling with default throughput.

### Migrations and representative locking

1. Clean replay all 40 immutable files in staging, checking the ledger, processing
   OFF, roles/extensions, grants/RLS and application compatibility.
2. In the disposable project replay the first 39 files. Seed two or more synthetic
   organizations, including one with 101 enabled rules and immutable history.
   Target 100,000 deliveries, 100,000 executions and 200,000 steps with valid
   provenance, plus temporal occurrences and operational records. Record actual
   row counts and relation/index sizes; if this volume is infeasible within the
   approved budget, reduce it explicitly and retain the representative gate PARTIAL.
3. Preserve row digests, rule/version links, receipts and OFF state before applying
   Stage 12. Independently exercise ordinary ticket mutations and reads during
   migration; sample lock holders/waiters, mutation latency, constraint and index
   timing. First rehearse a deliberately held conflicting transaction with a
   bounded migration-session lock timeout, then release it and retry unchanged SQL.
4. Initial operational acceptance: no failed ordinary mutations; p95 mutation
   latency below one second and no single mutation blocked more than two seconds;
   migration completes within five minutes on the stated volume. Exceeding these
   bounds fails a no-maintenance-window assertion and requires an evidence-backed
   migration/maintenance proposal. Do not alter immutable migration history.
5. Legacy 101 enabled rules remain enabled; another enable is rejected. Compare
   digests and controls after migration; no migration may activate processing.

### Sustained capacity, fairness and recovery

Use eight synthetic tenants: the largest contributes 60% of scheduled ordinary
arrivals and the other seven share the rest. Include nonmatching and historically
ineligible rules, matching one-action rules, explicit/natural notifications,
bounded retry failures and temporal/SLA-approaching cases. Count all resulting
deliveries, including action-generated events, in observed arrival rates.

- Warm-up: 15 minutes at one event/minute total.
- Steady mixed phase: four hours targeting two new events/minute total, including
  temporal emissions in that total; 20% nonmatching, 20% notification actions,
  10% bounded transient failures. Keep delayed retry debt in backlog measurements.
- Near-default phase: one hour targeting four new events/minute. This phase can
  fail sustainability when retries/caused events consume remaining claim slots;
  report the measured limit without changing configuration.
- Overload: ten minutes at 20 events/minute plus a 100-event burst, then no new
  arrivals for up to 90 minutes. Include large/small tenant competition and
  overlapping workers. A separate discovery backlog demonstrates the potential
  500 events/minute admission versus five delivery claims/minute mismatch.
- Short-SLA cases: create a declared mix of one-, two- and five-minute approaching
  windows, including thresholds encountered during overload. Report missed windows
  and lag individually; any lost approaching opportunity prevents claiming support
  for that window/workload. Do not use aged cursors as elapsed throughput evidence.

Accept sustainable phases only if every actionable event is accounted for, no
successful effect repeats, backlog has no positive trend over the final hour,
oldest actionable age stays below 180 seconds, and each continuously eligible
tenant progresses within two full tenant rotations (16 default invocations).
For overload, backlog growth is expected; all eventually eligible work must drain
within the declared recovery period, or report the residual queue and bottleneck.
Capacity deferral must preserve work and failure-attempt counts. Legitimate terminal
failures/exhaustion are measured separately from completed successful deliveries.

Record arrivals/completions per minute and tenant; p50/p95/p99 action and delivery
latency; oldest actionable age; capacity defer counts/duration; retry debt;
discovery lag/missed windows; lock waits; provider CPU/memory/I/O observations;
table/index bytes before/after; cron gaps and worker/discovery invocation IDs.
Missing provider telemetry stays unmeasured. Stop on any isolation/idempotency
failure, missing durable work, backlog above 1,500, oldest actionable age above
30 minutes during overload, database utilization above 85% for five minutes, or
the approved spending threshold. Stop input first and observe bounded draining;
turn processing OFF immediately for correctness/security failures.

### Boundaries, concurrency, controls and accessibility

Run the complete requested role/MFA/two-tenant matrix through hosted Auth,
PostgREST and browser/server-action flows: lifecycle, imports/exports/mapping,
immutable history, revision conflicts, dry-run zero effects and Operations. SQL
fixtures support these tests but cannot replace them. Use independent connections
for last-slot active/execution/recipient/tenant admission, token fencing, interrupted
steps, lease reclaim, retry exhaustion and duplicate notification protection.
Artificially primed counters test correctness only, not sustainable throughput.

Trace ordinary and temporal pipelines through durable event, delivery, rule/version,
planner, trusted command, receipt, execution/step and correlation/causation IDs.
Test actual cron, disabled/historically ineligible rules and strict revisions.
Toggle processing with pending eligible work; prove Administration and history
remain available. Re-enable under established activation cutoffs: old unadmitted
events do not automatically become eligible. Test temporal gates separately, then
restore both hosted controls OFF and verify readback before leaving the test.

Deployed UI matrix: 1440px, 834px, 390px and 200% zoom; templates, builder/temporal
controls, import mapping, dry run, history/detail and Operations. Test loading,
empty/error, capacity-delay/failure/exhaustion states, keyboard-only navigation,
visible/restored focus, labels/associated errors, draft preservation, no accidental
horizontal page scrolling, reduced motion and real VoiceOver/NVDA announcements.
Record screen reader/browser/OS versions and task outcomes. An accessibility tree
or automated checker alone does not close the screen-reader gate.

### Observability and restore

Inspect sanitized hosted logs using safe identifier allowlists, never credentials,
ticket descriptions, message bodies or sensitive configuration. Diagnose capacity
delay using available-at/capacity reason and unchanged failure attempts; diagnose
ordinary failure from step/execution outcome and retries; diagnose exhaustion from
terminal delivery plus terminalized execution. Capture invocation/correlation IDs
to connect the records, without including other tenants in administrator views.

Make a new synthetic staging backup; restore only into the disposable target after
its upgrade evidence is exported. Follow Stage 12B's tested schema/data/ledger
ordering, required roles/extensions and explicit custom Storage/Realtime policy
export. Verify provider-owned object compatibility before restore. Compare row
digests, 40-file ledger, permissions, immutable links, receipts, Auth login/MFA and
OFF state. Document separate recovery of provider Auth/redirect settings, environment
secrets and any Storage object bytes; a logical database dump alone covers none of
those settings/bytes. Never read the prepared production backup. Keep deduplication,
provenance/audit and immutable execution retention risks from Stage 12; no deletion
policy is introduced by this verification.

## Current gate ledger — Docker continuation

Tested application and SQL: `048a16280310b65838192d5ac1aef8100a5bd6bc`.
Fresh local environments: `fixxflow-stage12c-local`, `fixxflow-stage12c-upgrade`,
`fixxflow-stage12c-restore`; PostgreSQL 17.11, CLI 2.119.0, Node 24.21.0.
The isolated production-mode Next application at localhost:3100 was built from
tracked files without `.env*`, `.vercel`, or production credentials. Its isolated
copy uses webpack because its node_modules is symlinked outside that copy; the
normal repository production build also passed independently. No hosted deployment
exists. PASS below is explicitly local; it does not close provider-specific gates.

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| Hosted PostgreSQL 17 migrations | BLOCKED hosted; PASS local | Fresh 40-file replay; independent 39→40 upgrade preserves rules, versions, executions, steps and OFF state. No changed migration hashes. |
| Representative migration locking | PASS at local tested volume; PARTIAL operationally | 100,000 tickets/events/deliveries/executions; 200,000 steps. Deliberately held reader visibly blocks migration; one-second lock timeout rolls it back. Unchanged migration then completes in 874.928 ms. Six independent ticket mutations succeed, maximum/p95 62.744 ms. Not a hosted maintenance-window guarantee; individual constraint/index costs not separately timed. |
| Application/PostgREST behavior | PASS for local exercised flows; PARTIAL full matrix | Real Next production server, SSR cookies and GoTrue/PostgREST; 39 HTTP boundary checks plus browser create/edit/import/map/duplicate/archive, revision conflict, dry run and active-limit feedback. Full hosted/session-redirect matrix untested. |
| Authorization, MFA, tenant isolation | PASS local | Genuine TOTP AAL2 administrator; AAL1, technician, end-user and foreign-tenant denial. Foreign selected reference UUID not exposed; Operations does not expose sibling organization. |
| Independent concurrency | PASS local | Separate HTTP requests race for final active-rule, execution, recipient and tenant notification slots. Independent SQL transaction overlaps repeated commands. No shared in-memory counters. |
| Worker and temporal discovery end-to-end | PASS local exercised pipeline; BLOCKED hosted | Protected Next routes invoke actual worker/discovery and trusted commands. Ordinary/nonmatching/notification work and real one-minute open thresholds flow through persisted receipts. Separate 210-versus-one temporal probe emits 101, 100, 10, 0 with rollback/cursor/idempotency checks. Short SLA window discovered with 31.228 s lag and executed; a later deliberately missed deadline is observable without event creation. |
| Actual cron scheduling | BLOCKED | A local timer invokes HTTP routes at the unchanged 60-second cadence. No Vercel scheduled invocation was tested. |
| Sustained capacity and fairness | FAIL sustained target; PASS bounded drain/fairness | 35 arrival batches across eight tenants: 140 ordinary tickets plus eight temporal events. Sampled arrivals 4.206/min versus completion 3.411/min. At arrival stop: 28 pending, oldest 713.103 s. All 148 deliveries eventually acknowledge at unchanged cadence; 667.443 s same-generation drain. No failure/retry/capacity-deferral outcome or duplicate completed step. Every tenant progresses. |
| Notification protection | PASS local correctness; PARTIAL delivery | Tenant/recipient contention, duplicate receipts, rollback and defer/resume verified. Timed workload includes notifications. Email dispatcher returns 503 with delivery configuration absent; no external customer mail possible through this app. |
| Failure recovery | PASS bounded local cases; PARTIAL full operational matrix | Separate actual worker process killed after its first committed command. Original 120-second lease expired naturally (120.829 s wait); new worker completed the remaining step with exactly one attempt/effect per step; old token refused finish. Deferral refunds retries and eighth-attempt exhaustion terminalizes execution. Full eight-attempt real-time dependency-outage sequence not measured. |
| Kill-switch behavior | PASS local HTTP | Separate production-mode Next server at localhost:3102 tested environment OFF with database ON, then environment ON/database OFF. Worker/discovery stop; rules, versions, events, deliveries, history and messages preserved; real-session Administration available. New activation preserves old unadmitted work without replay; new-generation ticket executes exactly once. Test DB OFF and server stopped. |
| Observability | PARTIAL | Actual worker JSON identifier allowlist and persisted event→delivery→immutable version→execution→step/correlation trace pass. App and database stdout/stderr samples contain none of the tested credentials, MFA seed or content canaries. Worker action logs omit the Operations invocation UUID, leaving time-based rather than exact invocation association. Hosted sinks untested. |
| Responsive and keyboard checks | PARTIAL | Real Safari browser flows below; full state-by-viewport matrix and reduced motion incomplete. |
| Screen-reader audit | BLOCKED | VoiceOver started but no complete spoken-output workflow audit was obtained. Turned OFF at owner request and confirmed OFF. AX inspection is not a substitute. |
| Restore rehearsal | PASS local logical recovery; PARTIAL full recovery | Fresh synthetic backup restored into an empty third PG17 stack. All 49 table digests and custom Storage/Realtime policies match; 40 migration records, 101 enabled rules, 100,006 tickets and OFF preserved. Post-restore real Auth login/MFA, hosted settings, object bytes and PITR not covered. |
| Tests, typecheck, lint, build | PASS local | Final suite 707/707, zero failures/skips (22.844 s); typecheck, ESLint zero warnings and Node24 processing-OFF production build pass. |

### Actual capacity and storage measurements

The 35 steady arrival batches span 34.003 minutes between their first and last
samples. Rates use counter differences between those samples, excluding the first
immediate batch: **4.206 arriving deliveries/minute versus 3.411 completed/minute**.
This workload therefore was not sustained. At handoff, 147 deliveries existed,
119 had acknowledged, 28 waited and oldest actionable age was 713.103 seconds.
One final temporal threshold added a delivery during drain. Processing generation
stayed unchanged throughout; twelve further scheduled invocations drained all
148 deliveries in **667.443 seconds from handoff**. The first followed the prior
scheduled tick rather than starting a new minute at handoff.

Final executions: **148 succeeded, 140 condition skips**; 148 successful steps,
none attempted more than once. Every durable event has a delivery. Final tenant
acknowledgements are 84 for the large tenant, 16 for the temporal tenant and eight
each for the other six tenants. No timed-run capacity-specific deferrals, retries
or failures occurred: its backlog was caused by claim throughput, not a full
execution/notification quota. Contention/defer/refund tests are separate evidence.

Database-recorded successful action duration: median **3 ms**, p95 **4 ms**,
p99 **5.53 ms**, maximum **10 ms**. Maximum complete worker HTTP invocation:
**221.984 ms**. These are local command/HTTP observations, not email delivery or
hosted latency. Sampled database memory was approximately 200–234 MiB during the
run; other synthetic stacks and local checks shared the Docker host. There is no
continuous hosted resource/lock profile.

| Operational relation | Table growth, bytes | Index growth, bytes |
| --- | ---: | ---: |
| Domain events | 237,568 | 49,152 |
| Deliveries | 57,344 | 32,768 |
| Executions | 147,456 | 278,528 |
| Execution steps | 114,688 | 188,416 |
| Temporal occurrences | 8,192 | 40,960 |
| Invocation records | 65,536 | 32,768 |
| Missed windows in this timed stack | 0 | 0 |
| Notifications | 40,960 | 40,960 |

These are physical before/after relation allocations, including page/index
allocation effects; they are not per-row growth estimates. The separate SLA probe
records a missed window in its own database. No retention/deletion was introduced.

### Limits of the completed probes

The timed arrival workload has one worker and one discovery invocation each minute,
called sequentially through actual HTTP endpoints. It contains no injected
retry-heavy dependency outage, overlapping scheduled invocations or notification
fanout saturation. Those controls have bounded independent-request/SQL correctness
evidence, not one combined sustained-load pass. The real short SLA-window probe
is separate from the timed arrival workload. The full eight-attempt backoff chain
would take substantially longer; terminalization was exercised at the established
last attempt. No safety ceiling is reported as measured throughput.

The pending 80-ticket burst was not run after the steady workload failed. The
original proposed hosted multi-hour plan remains unexecuted. Resource observations
are samples from a shared development Docker host, not continuous hosted CPU/I/O/
lock profiling. UI checks do not cover every loading/error/detail state or reduced
motion; a real screen-reader auditor still needs to complete the spoken workflows.
No actual Vercel cron invocation, hosted domain MFA/redirect flow, external mail
capture/provider dispatch, hosted backup/PITR or Storage object-byte recovery was
verified. These gaps remain explicit regardless of the choice not to buy staging.

### Migration and restore evidence

The representative execution/step history is owner-seeded synthetic data with valid
constraints/provenance, for scan and locking verification. It does not represent
100,000 executed actions. Before migration, executions used 30,375,936 table bytes
and 58,286,080 index bytes; steps 34,906,112 / 71,745,536; deliveries 13,467,648 /
31,629,312. Six mutations are a bounded locking sample, not a throughput benchmark.

Restore order: start an empty Supabase 17 stack with its managed roles/extensions;
export schema, data with COPY (excluding verified-empty managed vector tables),
and migration schema/data via CLI `db dump --local`. Export the application's
Storage/Realtime policies separately with an **empty search_path** so deparsed
expressions remain fully qualified. Restore application schema and those policies,
then data with `session_replication_role=replica`, then migration schema/data, in
one transaction. Compare row digests, policies, foreign-key provenance and OFF.
Never restore into production. Logical database recovery does not restore Auth
provider/redirect settings, deployment secrets, Storage bytes or cron-host settings.

The first C restore attempt exposed a helper defect: policy expressions exported
with the source default path referenced `knowledge_articles` without a schema;
the dump deliberately sets an empty restore path. It rolled back cleanly. The C
helper now exports through `pg_catalog.pg_policies` with an empty path; replay and
all comparisons pass. No migration history was repaired or application SQL changed.

### Browser and accessibility observations

Safari on the real localhost production server, synthetic administrator AAL2:

- Template choice places focus in Name. Incomplete save focuses a textual error
  summary and preserves the draft; condition/note controls expose associated errors.
- At 100 enabled rules, enable fails with the explicit active safety-limit message;
  the selected rule remains disabled. The message wraps at 390px.
- Temporal duration zero is rejected by native validation and focuses Duration;
  valid one-minute duration saves. Independent revision update causes the stale
  browser save to preserve the draft and show the comparison/reload message.
- Dry Run focuses its results and says no changes were made. Digests of ten tenant
  data/accounting tables before/after are identical while other tenants process.
- Actual exported JSON imports disabled. A mapped technician package cannot proceed
  without a destination; the error receives focus. Native keyboard selection
  confirms a tenant-local destination; review focuses Name, save remains disabled.
- Duplicate saves disabled; archive requires the established confirmation. Browser
  navigation away from an unsaved draft prompts to stay or leave.
- Operations inspected at 1440px, 834px and 390px. Text distinguishes capacity delay,
  notification delay, action failure and retry exhaustion; observed empty-state
  layout stacks at mobile width with no visible horizontal page overflow. Actual
  200% browser zoom was selected and confirmed in Safari; Operations reflows with
  readable queue labels. These observations do not prove every data-rich state.
- Keyboard skip link reaches the history content; Tab enters labeled filters;
  keyboard submission preserves filter text. Operations disclosure accepts keyboard
  interaction with visible focus. Complete keyboard-only lifecycle remains partial.

No UI code or design tokens were changed. Existing builder, ReferencePicker,
alerts, buttons, history filters and Operations components were reused. No design
exception was introduced. Real screen-reader output, reduced motion, all loading/
error states and the complete execution-detail viewport matrix remain outstanding.

## Changes, remaining blockers and release sequence

Only manual Stage12C verification helpers and documentation are changed. No runtime
feature, migration, dependency, subscription tier or safety setting was changed.
The default capacity configuration currently fails this local workload; this is
an operational bottleneck, not evidence of lost events or failed ticket writes.
Arrivals were stopped after 35 batches (140 ordinary tickets; 34.003 minutes
between first/last samples), because the acceptance target had already failed.
The original 60-minute arrival plan and subsequent 80-ticket burst are explicitly
unexecuted beyond that point. The same activation generation and 60-second worker/
discovery cadence are retained for backlog-drain measurement; it does not turn the
failed sustained target into a pass.

The first interruption-helper run expected a stale-token finish RPC to raise an
error; the established contract returns `false`. Correcting that assertion and
rerunning the full wall-clock interruption scenario passes. This was a verification
harness error, not an application token-fencing defect.

The claim function allocates five bounded **tenant visits**, not five guaranteed
successful claims. A tenant with retained ineligible events can consume a visit
while advancing its 100-candidate cursor. This preserves bounded work and eventual
progress but reduces useful throughput below five deliveries/minute. The discovery
ceiling remains up to 500 events/minute. No limit, batch or cadence was raised.
Proposed follow-up: separate successful-claim count from bounded tenant scanning,
without increasing the five-delivery batch or 500-candidate eligibility budget, and
avoid revisiting the same exhausted/ineligible tenant repeatedly in one invocation.
Measure the extra indexed tenant-selection cost and repeat the same workload before
accepting it. This is a proposal, not an implemented scheduler change. It cannot by
itself solve a potential 500-event/minute discovery input against five claims/minute.
Broader discovery admission/cadence choices require workload forecasts and a separate
contract decision. Preserve tenant fairness, retry share, token fencing and durability.

The owner requested moving toward production once local verification passes. That
condition is not satisfied. Production remains untouched; no paid staging is being
created. Hosted cron, provider limits/latency and deployment-specific authentication
remain unverified independently of any purchasing decision. The incomplete real
screen-reader audit also remains explicitly open. Current evidence does not support
Automation activation.

Recommended later deployment: establish an exact tested release manifest and fresh
backup/recovery evidence under the appropriate production authorization; compare
the actual migration ledger without assuming the historical Stage8 list; apply only
pending immutable migrations with processing OFF and bounded lock acquisition;
verify the full manifest and OFF state; deploy the tested application on Node24
with environment flag false; verify ordinary ticket work, Administration and
protected disabled cron responses. Stop before activation. Do not use the prepared
production backup as a disposable test artifact.

A later narrowly scoped activation must explicitly account for the **global**
processing gate, all enabled rules and activation cutoffs. Limit eligible canary
work, turn on the environment gate while the database remains OFF, then enable the
database gate last. Monitor actionable age, per-tenant progress, deferrals and
failures against measured acceptance thresholds, retaining an immediate OFF path.
Old unadmitted work is not automatically replayed after a new activation generation.

Final controls: all three Stage12C databases read **OFF**, PostgreSQL17.11, 40
migration records. The main app was restarted with its environment flag OFF; both
worker and scheduler HTTP routes returned `{"disabled":true}`. All Stage12C helper/
app processes and Docker containers are stopped; data volumes remain preserved.
Stage12B stacks/artifacts and the prepared production backup are untouched. No
hosted controls exist; production controls were neither queried nor changed.

### Reproduction and retained artifacts

Manual helpers `tests/helpers/automation-stage12c-*.mjs` are fixed to the named
localhost Docker projects and do not load repository `.env` files. Use Node24 and
the installed Supabase CLI on PATH. They are outside the ordinary 707-test suite.
Run clean replay before `postgrest`; then isolated app `build`/`controlled-test`,
HTTP boundaries/browser flows and capacity. `drain` accepts only the exact running
capacity-generator PID and is the documented early-failure handoff, never a normal
way to turn failing results into a pass. Its finally block restores database OFF.

Use the separate 39-file upgrade stack for `upgrade`, then export its unchanged
synthetic backup and run `restore` into the third empty stack. After backup evidence
is captured, `contention`, `interruption`, `temporal` and `controls` use the upgrade
stack serially, each starting/ending OFF. The recovery application is built against
its separate 54421 API port. Do not run these against the timed capacity stack.

Private synthetic session files and logical SQL dumps remain only under `/tmp`
with mode 0600. Do not commit them. Local Docker volumes/workdirs and backups may
be removed after owner review of the sanitized evidence; do not confuse them with
Stage12B artifacts or the prepared production backup. Stopping local containers
preserves data for diagnosis. No hosted resources were provisioned, hence no new
Supabase/Vercel staging charge was incurred. Local disk/CPU costs are not cloud fees.

Retention remains a separate design task: keep connected event/delivery/execution/
step/version provenance and deduplication records together; retain temporal
occurrence uniqueness long enough to prevent rediscovery. Capacity windows reset
in place, but operational history and events from ordinary ticket work continue to
grow even with Automation OFF. The Stage12 illustrative budgets and proposed
retention periods remain recommendations, not an automatic deletion policy.

### Files and final verification

Changed: this report, `docs/automation-stage12c-evidence.json`, the current-gate
section of `docs/automation-rollout.md`, and 18 `tests/helpers/automation-stage12c-*.mjs`
manual verification helpers. No application source, dependency, migration, product
UI or production configuration file changed. All 40 migration hashes still match
Stage12B. Final diff/whitespace checks pass; the helper hashes identify the
verification code separately from the unchanged application commit.
