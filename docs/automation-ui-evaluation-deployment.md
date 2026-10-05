# Automation UI evaluation schema deployment

Production schema deployment completed on **2026-10-01**, under the user's
conditional approval for UI evaluation. **Automation processing remains OFF.**
No product-development stage, activation, worker invocation, scheduler invocation,
notification action, retry test, history replay or production restore was performed.

## Result

| Check | Result |
| --- | --- |
| Project | FixxFlow `dhuikxkrokowvnvzpihp`, us-west-2, PostgreSQL 17.6 |
| Migration history before / after | **26 → 39**, all aligned; zero pending/remote-only |
| Migration push | **PASS**, exactly 13 files, CLI 2.119.0, no failure |
| Application schema comparison | **PASS**, 1,662/1,662 fingerprints match local clean replay |
| Backup/recovery checkpoint | **PASS for this deployment**, logical archive revalidated plus completed physical backup; restore rehearsal remains blocked |
| Processing before | Vercel flag absent/default OFF; database control not installed |
| Processing after | Vercel flag unchanged; database `active=false`, generation 0 |
| Runtime activity after | Zero runs, cursors, occurrences, events, deliveries, executions and steps |
| Hosted PostgREST | **PARTIAL**: all seven anonymous read requests denied; authenticated coverage blocked |
| Administrator / technician / employee / MFA HTTP verification | **BLOCKED**: signed-in browser unavailable; no impersonation or weakened policies |
| Vercel integration | **PARTIAL**: Stage 10 production deployment READY; four protected routes redirect unauthenticated requests to `/login` |
| Signed-in UI workflows and 1440/834/390px checks | **BLOCKED**, computer-use native pipe startup failure persists after user reconnect and runtime reset |

Machine-readable evidence: [deployment manifest](automation-ui-evaluation-deployment.json).
The older ten-migration preflight is historical and was not used as current approval.

## Exact migrations applied, in order

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
11. `20261001160233_automation_temporal_episodes.sql`
12. `20261001160248_automation_temporal_discovery.sql`
13. `20261001165514_automation_operations.sql`

The first 26 applied identifiers and SQL-body MD5 equality checks matched local
files, including routing IDs `20260926024852` and `20260926025012`. No migration
repair or remote history manipulation occurred. SHA-256 values of the 13 files
were pinned before pushing and verified unchanged afterward.

Commands used the installed CLI 2.119.0 equivalent of:

```sh
supabase migration list --linked --project-ref dhuikxkrokowvnvzpihp
supabase db push --linked --project-ref dhuikxkrokowvnvzpihp --skip-vault --dry-run
supabase db push --linked --project-ref dhuikxkrokowvnvzpihp --skip-vault --yes
supabase migration list --linked --project-ref dhuikxkrokowvnvzpihp
```

The fresh dry run and actual push both reported precisely these 13 files, empty
seed/role lists and no Vault synchronization. No credentials were included in
commands or committed evidence. CLI exit status was 0. No failed migration needed
recovery. Migration files were not edited during deployment.

## Review of the three new migrations

### Temporal episodes — `20261001160233`

Adds nullable `unassigned_since`, `unassigned_episode_id`,
`waiting_on_user_since`, `waiting_on_user_episode_id` plus four consistency checks
to `public.tickets`. Revokes client insert/update access to these columns. Adds
private episode preparation and `tickets_y_temporal_episodes` BEFORE trigger after
routing/SLA preparation and before final revision/event capture. Renames the old
snapshot helper and wraps it with an allowlisted temporal snapshot function;
revokes direct invocation of both helpers.

No ticket UPDATE/backfill, guessed timestamp or extra artificial revision occurs.
Existing rows retain unknown/null episodes. No new table, RLS policy, index or enum
is added by this file. ALTER TABLE takes ACCESS EXCLUSIVE; checks may scan existing
rows under that lock. Nullable columns avoid a data rewrite. Trigger/function DDL
also takes catalog/object locks. Explicit BEGIN/COMMIT makes the file transactional.
At inspection tickets had **0 rows**, 262,144 bytes including existing indexes.
The unavoidable table lock was acceptable at this verified volume.

### Temporal discovery — `20261001160248`

Extends the trusted registry; adds `domain_events.temporal_occurrence_id`; replaces
revision/type uniqueness with NULLS NOT DISTINCT uniqueness including occurrence;
creates private temporal occurrence and cursor tables with tenant/version/ticket/
event foreign keys and durable logical-occurrence uniqueness. The occurrence-to-
event FK is initially deferred. Both private tables enable RLS with no client
policies and revoke direct access, including service-role table grants.

Adds five partial ticket indexes for tenant/anchor/id discovery: unassigned,
waiting, open age, response SLA and resolution SLA; adds one active-rule index.
Adds private temporal context/matching helpers, wraps ordinary event compatibility,
adds service-only bounded discovery RPC, and replaces existing eligibility,
execution admission and dry-run read functions to accept trusted temporal context.
No existing policy is weakened. No enum, ticket backfill, event replay or scheduled
job is created. No function is invoked merely because its definition is installed.

ALTER TABLE/unique-constraint replacement takes ACCESS EXCLUSIVE on domain events;
FK creation can take SHARE ROW EXCLUSIVE on related tables. Regular CREATE INDEX
is **not CONCURRENTLY** and blocks writes while building; locks persist to the
explicit transaction commit. At this checkpoint tickets are empty and all
Automation/event tables are newly installed and empty. Index scans therefore
have negligible data volume, although lock acquisition can still wait for other
transactions. No waiting locks or transactions older than 30 seconds were observed
immediately before deployment.

### Operations — `20261001165514`

Adds private invocation and missed-window tables, RLS, constrained service-write
RPCs, sanitized heartbeat helper, admin/MFA guard, bounded tenant overview and
history read RPCs. Read grants go to authenticated callers with independent SQL
administrator checks. No direct private-table client policies/grants are introduced.

Adds eight explicit indexes: three invocation indexes, tenant/recent missed-window
and occurrence indexes, tenant/recent execution index, and two partial tenant
queue/completion delivery indexes. Primary/unique constraints create their usual
supporting indexes. Replaces discovery only to record its already-skipped missed-
approaching-window case; no event, delivery or execution is created for a miss.

No backfill, deletion, purge, enum change, activation or cron schedule is present.
Explicit BEGIN/COMMIT encloses DDL. Regular indexes take write-conflicting locks;
FK creation also locks referenced tables. All affected runtime tables are empty
for this deployment, and no long/waiting transaction was observed. Creation and
schema validation finished without reported lock/deadlock/timeout errors. Exact
lock hold times were not separately sampled and are not claimed.

### Recovery considerations

These are forward migrations, not reversible runtime switches. File-level
transactions roll back uncommitted DDL, but previously committed migrations remain
if a later file fails. The notification enum addition is deliberately in its own
migration before use. There was no failure in this deployment.

After commit, keep processing OFF and prefer a reviewed forward correction over
ad-hoc DROP/repair. A full database restore is a separate, explicitly authorized
incident operation with downtime and loss of writes after the chosen recovery
point; do not automatically restore or delete runtime/history tables. No down
migration or restore was executed.

## Recovery checkpoint

The original custom archive was retained unchanged:

- Directory: `/Users/devdigitalbvi/FixxFlowBackups/20261001T150251Z`
- Snapshot window: **15:02:55–15:03:45 UTC, October 1, 2026**.
- Archive size: **905,484 bytes**, owner-only mode `0600`, directory `0700`, outside Git.
- SHA-256: `134ec92cc4e254af6300bbcbbc2dc62b7f78b7ab7b640e61d34f1810fb9f5cee`.
- Revalidation: checksum matches; `pg_restore --list` and full decode to `/dev/null`
  both succeed. No data rows were printed. Existing password-free roles export
  remains alongside it. No backup artifact or manifest was overwritten.

All **30 public/private application-table counts** matched counts decoded from the
archive in memory. No audit events occurred since backup; latest audit was
September 27. Inspected asset, category, organization and profile update timestamps
showed no changes after the backup window began. This supports retaining the backup
for unchanged application data; it is not a byte-for-byte comparison of every
managed Auth/session record. No fresh backup was necessary for material application
changes under the requested decision rule.

Supabase backup inventory confirms WAL-G daily physical backups, latest listed
completed point **2026-10-01T11:41:11.659Z**; eight daily entries were visible
September 24–October 1. PITR is disabled. Inventory timestamps do not prove an exact
WAL recovery boundary. Restore is through Supabase's backup restore mechanism,
requires separate authorization, and was not rehearsed. Restoring that physical
point can lose later writes. Database backups exclude uploaded Storage file bytes
and deployment configuration. The logical archive is not encrypted at rest; its
existing owner-only storage was preserved. PG18-produced logical restore into
representative Supabase PG17 still needs rehearsal.

Reference: [Supabase backup and recovery limitations](https://supabase.com/docs/guides/platform/backups).

## Post-deployment verification

The read-only application fingerprint query compared production PG17.6 with the
39-file clean local replay: **1,662 expected and actual objects, no missing,
unexpected or changed fingerprints**. Covers columns/defaults, tables/RLS flags,
constraints, indexes, triggers, policies, function definitions/security/search
paths, enums and relevant table/column/function grants. PG18-only named NOT NULL
constraints are excluded consistently; column nullability is checked separately.
This establishes schema equality within that scope, not full hosted behavior.

Public rule/version/execution/step tables and private event, delivery, processing,
chain, command-context, version-visibility, temporal and Operations infrastructure
are present. Episode columns and trigger order match the repository.

At the final database checkpoint, 18:13:51 UTC:

| Record/control | Before | After |
| --- | ---: | ---: |
| Applied migrations | 26 | 39 |
| Assets | 77 | 77 |
| Categories | 11 | 11 |
| Audit events | 118 | 118 |
| Tickets / messages / notifications / email outbox | 0 | 0 |
| Automation rules / executions / steps | absent | 0 |
| Domain events / deliveries | absent | 0 |
| Temporal occurrences / discovery cursors | absent | 0 |
| Worker/discovery run records | absent | 0 |
| Database processing active / generation | absent | false / 0 |

Vercel production environment metadata has no `AUTOMATION_PROCESSING_ENABLED`.
Both cron routes return before service work when it is absent. The DB singleton
is inserted with `active=false`; no migration calls activation. No database cron
job was added for Automation. Existing Vercel cron requests may reach the OFF guard,
but no processing/telemetry invocation was recorded. No endpoint was manually
invoked to test workers, scheduling or the kill switch.

Security advisors: no warning/error findings; 11 informational
[RLS-enabled/no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
are expected for intentionally private infrastructure with all client grants
revoked. They were not “fixed” by adding permissive policies.

## Hosted/UI evaluation coverage

Production deployment: `dpl_36nMqjDKgTg5bNbALzK3RQn22ER6`, READY, commit
`3fea715ae85a94a234ffb9df5937216e071261f3` (Stage 10), served at
[FixxFlow](https://www.fixxflow.app). This task did not deploy application code.

Actual PostgREST calls using the public application key, without a user session,
returned HTTP 401 / SQLSTATE 42501 for:

- `automation_rules`, `automation_rule_versions`, `automation_executions`,
  `automation_execution_steps` reads;
- `read_automation_operations`, `read_automation_operations_history`,
  `read_automation_dry_run` read RPCs.

An initial test probe used nonexistent `automation_rule_versions.id`; it was
corrected to `rule_id` and then confirmed denied. This was a probe issue, not a
schema defect. No authenticated JWTs were fabricated, no accounts/permissions were
changed, and no secrets were printed.

Unauthenticated HTTPS checks of Automation list, new-rule gallery, Operations and
global history returned 307 redirects to `/login`. These validate route protection
and reachability only, **not** signed-in rendering or RPC success.

Computer-use returned no browsers/apps and `Sky Computer Use native pipe startup
failed`. The user reconnected; retry and a fresh runtime reset still failed. Thus:

- Administration navigation, six templates, scratch builder, condition/action/
  temporal controls and summaries: **not verified in hosted signed-in UI**.
- Save/edit/duplicate/enable/disable/archive flows: **not run**. Zero test rules created.
- Current/temporal dry runs and warnings: **not run**; also zero existing tickets
  are available. No ticket was created merely to populate these tests.
- Operations OFF/empty states and history/version rendering: schema is ready,
  but **signed-in pages not visually verified**. No fake executions created.
- Desktop/tablet/390px responsive evaluation and screenshots: **blocked**, not
  substituted with the previous local synthetic Stage 10 checks.
- Administrator allowed, technician/end-user denied and MFA through actual user
  sessions: **blocked**. Existing matching SQL guards are not substitutes.

No hosted UX defect can be ruled out until those checks run. No deployment-blocking
product defect was discovered, and no product fix was made during this task.

## Remaining gates and stop point

Complete signed-in UI evaluation after the browser-control connection is usable.
Keep global processing OFF, even while testing individual rule enablement.
Separately retained staging/activation gates: hosted tenant isolation,
representative independent concurrency, worker end-to-end, temporal discovery
end-to-end, failure recovery, kill-switch activation/recovery, deployed operational
observability, full screen-reader audit and representative restore rehearsal.

Hosted PG17 **migration installation and schema verification** now pass; this does
not close clean/upgrade rehearsal or all engine behavior gates on representative
hosted infrastructure. Actual PostgREST coverage is partial as recorded above.

Only this report and its JSON evidence manifest were added locally. All approved
migration bytes remained unchanged. Production schema alignment is complete;
activation and another product-development stage were not started.
