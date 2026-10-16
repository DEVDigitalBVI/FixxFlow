# Production readiness and deployment policy

This is the application-wide release policy for FixxFlow. It turns the Octopus
16-step deployment checklist into repository checks and named operational gates.
Feature-specific runbooks may add stricter requirements but cannot weaken these.

## Current status

Repository controls are implemented. FixxFlow intentionally uses a production-only
hosted environment; the product owner accepted the lack of a persistent staging
environment on 2026-10-16. A production release is not certified until the remaining
external activation items below are configured and a release record is complete.
Historical evidence in other documents must not be treated as current production
state.

Implemented in this repository:

- Node 24 lockfile builds, generated Next.js route types, lint, application tests,
  production dependency audit, production build, and proxy verification in CI.
- An isolated Supabase PostgreSQL 17 job that replays migrations and seed data, runs
  database lint, pgTAP, and all transactional SQL regressions.
- Public `GET /api/health/live` and bearer-protected `GET /api/health/ready`. The
  readiness probe verifies configuration and a bounded, read-only database query.
- Deployment smoke testing that checks health, exact release identity, public pages,
  and security headers and emits a sanitized evidence artifact.
- Safe structured logs for caught failures and uncaught Next.js request failures.
- Dependabot for npm and GitHub Actions, plus CodeQL JavaScript/TypeScript scanning.
- An application release record, rollback procedure, incident process, and scheduled
  production smoke workflow.
- Protected `main` requiring current application, database, and CodeQL checks, linear
  history, resolved conversations, and no administrator force-push or deletion.
- Scheduled health failures create or update a durable GitHub incident issue assigned
  to `DEVDigitalBVI`; a successful recovery check adds evidence but requires human
  review before closure.
- Production-only candidate smoke and promotion evidence. No workflow implies that a
  separate staging environment exists.

Activated external controls (verified 2026-10-16):

- Matching encrypted GitHub repository/`Production` environment and Vercel production
  secrets named `HEALTH_CHECK_SECRET`, plus repository variable `PRODUCTION_URL` set to
  `https://www.fixxflow.app`. `CRON_SECRET` remains a compatibility fallback and was
  not copied, disclosed, or rotated.
- GitHub protects `main` with strict application, database, and CodeQL checks before
  merge. Vercel's native TypeCheck and Lint checks target production and use
  `blocks=deployment-alias`, so a failed native check cannot receive the production
  domain.
- Vercel's default high-severity owner alerts remain active. Project-scoped rule
  `FixxFlow production anomalies` (`ar_01a145f4-f5e8-7759-88b3-1943afc48fdd`)
  notifies the team owner for medium-or-higher production 5xx and usage anomalies.
- Supabase production backup inventory shows eight consecutive completed daily
  physical backups from 2026-10-09 through 2026-10-16 in `us-west-2`. PITR is disabled;
  the observed rolling retention is approximately seven days. Evidence is recorded in
  `docs/recovery-drills/2026-10-16-hosted-backup-inventory.md`.

Recovery activation still required:

- Complete a provider-backed restore-to-new-project rehearsal. The local logical
  rehearsal completed on 2026-10-16 validates the application database chain but is
  not evidence that a hosted production backup can meet the approved RTO/RPO.

## Approved service objectives

The product owner approved these targets on 2026-10-16. They are operational targets,
not a claim that every supporting provider control has already been verified:

| Objective | Initial target | Evidence |
| --- | --- | --- |
| Availability | 99.9% per calendar month | External uptime checks and Vercel function errors |
| Error rate | Less than 1% 5xx over 5 minutes | Vercel logs/alerts |
| User performance | p75 Core Web Vitals remain in the `good` range | Vercel Speed Insights |
| Recovery point (RPO) | 24 hours | Verified daily physical backup inventory; PITR disabled |
| Recovery time (RTO) | 4 hours | Timed disposable restore rehearsal |
| Detection | Public or dependency failure detected within 25 minutes | Scheduled workflow plus provider alerts |

Daily backups can support only an approximately 24-hour RPO. A tighter RPO requires
approved PITR or another supported backup mechanism. The four-hour RTO remains
unverified for the hosted system until a provider-backed restore, application
reconnection, and smoke test complete within it.

## Environment model

| Environment | Application | Database | Data and integrations |
| --- | --- | --- | --- |
| Local/CI | Local Next.js build | Supabase CLI, PostgreSQL 17 | Synthetic seed data; Mailpit; no external email |
| Pull request preview | Vercel build/preview URL | None | Nonfunctional public Supabase placeholders; compile and static review only |
| Production | Canonical Vercel project/domain | Production Supabase project | Real data and production integrations |

Never point CI or automated fixtures at a hosted project. The accepted production-only
model increases release risk because it has no persistent environment for provider
integration testing. Compensating controls are required. GitHub holds merges until the
application, database, and CodeQL checks pass; Vercel holds the immutable production
candidate away from the custom domain until its native TypeCheck and Lint checks pass.
Destructive,
load, email, Storage, Auth-provider, and migration experiments remain prohibited
against production; use disposable local resources or a separately approved ephemeral
project. Pull-request previews intentionally cannot authenticate or read production
data and are not substitutes for end-to-end acceptance.

## Release gates

### Before deployment

1. Create a release record from `docs/release-template.md` and name the release owner,
   database recovery owner, incident commander, and rollback decision maker.
2. Pin the commit. Require clean CI application, database, dependency, and CodeQL
   results. Review Dependabot and security alerts; do not force a breaking audit fix.
3. Confirm the held production candidate passed smoke and approved non-destructive
   critical flows using the exact candidate and migration set.
4. Verify environment variable names without printing values. Confirm server secrets
   are not prefixed `NEXT_PUBLIC_`, the site URL is HTTPS, and automation stays off
   unless separately approved.
5. Verify the production migration ledger and run `supabase db push --dry-run` against
   the explicitly identified project. Stop on drift, remote-only entries, or unexpected
   files. Never use a production reset, seed, or automatic history repair.
6. Record the latest successful backup, retention, expected RPO, restoration owner,
   and a restore rehearsal no older than 90 days. Schema-changing releases require a
   recovery point made before the first migration.
7. Record the last known-good Vercel deployment ID and confirm it is schema-compatible.
   Additive database changes must remain compatible with both old and new application
   versions through the rollback window.
8. Share release notes, user impact, known issues, maintenance window, and support path.

### Deployment

1. Apply only reviewed pending migrations in order with bounded lock timeouts. Stop on
   the first error and preserve logs.
2. Deploy the pinned immutable Vercel artifact. Record deployment ID, commit, actor,
   start/end time, and migration ledger.
3. Run `Deployment smoke` against the exact deployment URL. A failure halts promotion.
   Do not bypass readiness, release-identity, or security-header failures.
4. Promote only after the smoke artifact is retained and the release owner approves.
5. Keep a responder available for the observation window. High-risk releases use a
   canary or controlled feature gate; Automation follows its stricter two-gate runbook.

### After deployment

1. Run smoke again against the canonical production URL, including authenticated
   critical flows. Review Vercel logs and Supabase health for new errors or latency.
2. Observe at least 30 minutes and compare error, latency, traffic, queue, cron, email,
   and business-flow results to the pre-deployment baseline.
3. Run the deeper regression matrix for changed workflows and integrations. Do not
   close the release until failures are triaged and all required checks pass.
4. Publish the release notes and known issues, link monitoring and evidence, collect
   support/feedback signals, and update this checklist with lessons learned.

## Monitoring and alerts

The scheduled `Production health` workflow runs four times an hour and fails on public
availability, database readiness, or security-header regression. A failure creates or
updates a GitHub issue assigned to `DEVDigitalBVI`; recovery comments on the issue and
a human owner decides when to close it. The owner must keep GitHub issue/assignment
notifications enabled. This is a safety net, not a substitute for provider alerts;
scheduled Actions can be delayed.

Vercel is the centralized source for the JSON events `application.failure`,
`request.failure`, `automation`, and `automation_operations`. Logs intentionally omit
error objects, request URLs, bodies, cookies, credentials, and ticket content. Search by
correlation ID, release SHA, route template, and safe code.

Minimum alerts:

- failed deployment/build or deployment smoke;
- liveness/readiness failure;
- 5xx/error anomaly and sustained latency regression;
- failed or delayed cron invocations;
- Automation degraded/failed runs, backlog growth, or retry exhaustion;
- notification/report delivery failures;
- Supabase database resource, connection, backup, and availability warnings;
- cost/usage anomaly.

Every alert needs a named recipient, severity, acknowledgement expectation, escalation
path, and link to `docs/incident-response.md`. Test routing quarterly without exposing
secrets or sending real customer notifications.

## Backup and recovery

Before each schema-changing release, record the provider backup point and retention.
Database backups do not include Storage object bytes or all provider configuration;
those need separate inventory and recovery procedures.

The read-only inventory on 2026-10-16 confirmed PostgreSQL 17.6.1.166, daily physical
backups, WAL-G enabled, PITR disabled, a newest completed recovery point at
2026-10-16T11:39:05Z, and an oldest visible completed recovery point at
2026-10-09T11:46:01Z. This supports the approved 24-hour RPO under normal backup
operation but does not prove the four-hour RTO or cover Storage object bytes.

At least quarterly, restore into a newly created disposable project, never production.
Time the operation; verify migration history, row counts/digests, grants, RLS, MFA,
Storage references, critical workflows, readiness, and smoke. Keep processing and email
off. Destroy the disposable target only after evidence is retained and the owner
confirms completion.

If the rehearsal exceeds the RTO or cannot meet the RPO, mark production readiness
blocked and either revise the approved objectives or improve the backup tier/process.

The 2026-10-16 local logical recovery drill is recorded in
`docs/recovery-drills/2026-10-16-local.md`. It verified schema, migration history,
critical synthetic records, grants, and RLS in a separate PostgreSQL 17 container. It
does not replace the required provider-backed restore-to-new-project rehearsal because
it did not originate from a production physical backup and did not test Storage,
provider configuration, production data volume, DNS, or application reconnection.

## Rollback rules

- Application-only failure with compatible schema: use Vercel instant rollback to the
  recorded last known-good deployment, rerun smoke, and preserve failed-deployment logs.
- Additive database defect: stop affected processing and prefer a reviewed forward fix.
  Never edit an applied migration or drop customer/history data ad hoc.
- Incompatible schema or data corruption: invoke the authorized recovery owner. Record
  the recovery point and expected data-loss window before restoring. Reconcile writes
  after the recovery point and reconnect application/integrations before smoke.
- External side effects such as sent email cannot be undone by application or database
  rollback. Preserve receipts and communicate impact.

Use `docs/incident-response.md` for command authority, severity, evidence, recovery,
communications, and post-incident review.
