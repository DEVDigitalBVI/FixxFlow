# Production readiness and deployment policy

This is the application-wide release policy for FixxFlow. It turns the Octopus
16-step deployment checklist into repository checks and named operational gates.
Feature-specific runbooks may add stricter requirements but cannot weaken these.

## Current status

Repository controls are implemented. A production release is not certified until
the external activation items below are configured and a release record is complete.
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

External activation still required:

- Create or nominate a separate Supabase PostgreSQL 17 staging project and Vercel
  staging project. This can create cost and requires owner approval.
- Configure GitHub `staging` and `production` environments. Require a reviewer for
  production and add `HEALTH_CHECK_SECRET`; its value must match that environment's
  Vercel `CRON_SECRET`. Add `VERCEL_AUTOMATION_BYPASS_SECRET` only when preview
  deployment protection requires it.
- Add repository secret `HEALTH_CHECK_SECRET` for scheduled production monitoring
  and repository variable `PRODUCTION_URL` if the canonical URL changes.
- Protect `main` and require `Checks / application`, `Checks / database`, and the
  eligible CodeQL check. Configure Vercel Deployment Checks or manual promotion so a
  failed smoke run prevents production promotion.
- Configure alert recipients in GitHub Actions and Vercel. If the plan supports
  Vercel Alerts, notify the on-call owner for 5xx/error and usage anomalies.
- Approve recovery objectives, verify current backup retention, and complete a
  disposable restore rehearsal before certifying the first release.

## Initial service objectives

These are provisional engineering targets until the product owner records approval:

| Objective | Initial target | Evidence |
| --- | --- | --- |
| Availability | 99.9% per calendar month | External uptime checks and Vercel function errors |
| Error rate | Less than 1% 5xx over 5 minutes | Vercel logs/alerts |
| User performance | p75 Core Web Vitals remain in the `good` range | Vercel Speed Insights |
| Recovery point (RPO) | 24 hours | Supabase daily backup inventory |
| Recovery time (RTO) | 4 hours | Timed disposable restore rehearsal |
| Detection | Public or dependency failure detected within 25 minutes | Scheduled workflow plus provider alerts |

Daily backups can support only an approximately 24-hour RPO. A tighter RPO requires
approved PITR or another supported backup mechanism. The four-hour RTO is unverified
until a full restore, application reconnection, and smoke test complete within it.

## Environment model

| Environment | Application | Database | Data and integrations |
| --- | --- | --- | --- |
| Local/CI | Local Next.js build | Supabase CLI, PostgreSQL 17 | Synthetic seed data; Mailpit; no external email |
| Staging | Separate Vercel project/domain | Separate Supabase PG17 project | Synthetic users in two tenants; isolated secrets; Resend test/sandbox delivery or disabled email |
| Production | Canonical Vercel project/domain | Production Supabase project | Real data and production integrations |

Never point CI or automated fixtures at a hosted project. Never copy production rows,
credentials, Storage objects, or Auth identities into staging. Match runtime version,
database major version, regions, cron cadence, environment variable names, and provider
features. Record unavoidable size or plan differences in the release record.

Staging setup sequence:

1. Obtain cost approval and create the isolated projects.
2. Record project IDs, owner, region, PostgreSQL exact version, plan, and cleanup policy.
3. Apply the complete immutable migration chain to the empty staging database. Never
   seed production; staging uses synthetic fixtures only.
4. Configure the environment variables listed in `.env.example`, with unique staging
   values. Keep `AUTOMATION_PROCESSING_ENABLED=false` and the database automation gate
   off until its separate canary is approved.
5. Configure Auth URLs, MFA, email capture/test delivery, cron authentication, Storage,
   Realtime, and Vercel deployment protection.
6. Run authenticated acceptance for administrator, technician, employee, platform
   owner, cross-tenant denial, AAL1/AAL2, scheduled jobs, email, uploads, Realtime,
   accessibility, responsive layouts, and failure recovery.
7. Run the `Deployment smoke` workflow against the exact staging deployment and retain
   its 90-day evidence artifact.

## Release gates

### Before deployment

1. Create a release record from `docs/release-template.md` and name the release owner,
   database recovery owner, incident commander, and rollback decision maker.
2. Pin the commit. Require clean CI application, database, dependency, and CodeQL
   results. Review Dependabot and security alerts; do not force a breaking audit fix.
3. Confirm the staging deployment passed smoke and critical authenticated flows using
   the exact candidate and migration set.
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
availability, database readiness, or security-header regression. GitHub notifications
must reach the on-call owner. It is a safety net, not a substitute for provider alerts;
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

At least quarterly, restore into a newly created disposable project, never production.
Time the operation; verify migration history, row counts/digests, grants, RLS, MFA,
Storage references, critical workflows, readiness, and smoke. Keep processing and email
off. Destroy the disposable target only after evidence is retained and the owner
confirms completion.

If the rehearsal exceeds the RTO or cannot meet the RPO, mark production readiness
blocked and either revise the approved objectives or improve the backup tier/process.

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
