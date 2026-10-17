# Pilot release — 2026-10-17

## Identity and decision

Production application: `723ad87ffac09087fd9f7067b9f5ff5ff269e177`.
Deployment: `dpl_5LUY1r6nF6xnW3tMg5vvR9qvbM56`,
`https://fixx-flow-4ygpbxais-fixx-flow.vercel.app`, promoted to
`https://www.fixxflow.app` around 13:05 UTC.

The product owner authorized the pilot activation and hosted logical recovery drill.
The product owner retains release, incident, rollback, and recovery decisions;
Codex executed the authorized checks and changes. The release is deployed and the
functional/monitoring checks passed. Full production-readiness certification remains
open pending physical-backup recovery proof. UI/UX adjustments are deferred at the
owner's request until these checks are complete.

Last compatible deployment: `dpl_FFAKztESuPG3k8BCp6aKb9VN7myq`, commit
`ccb52ced264da5ba31d4f58868715027008bbfd3`. The report-date function change is
compatible with that application. Rolling back the application also requires review
of the invitation template, which now depends on the corrected callback.

## Changes and checks

- Ticket composer preserves audience selection and separate public/private drafts.
- Invitation links use a token hash verified by Supabase before password setup.
  The owner accepted the real Gmail invitation, chose a password, and signed in.
  Its membership is active with role `end_user`; retain it for the owner's UI/UX tests.
- A real support-chat notification was dispatched to the administrator on attempt 1.
  The outbox reported sent with a provider ID and no error; the owner confirmed
  inbox delivery. No matching titled test ticket was needed for this actual flow.
- Hosted invitation-template readback matched the checked-in template; only
  `mailer_templates_invite_content` changed. Site URL remains canonical HTTPS.
- Migration `20261016120000_fix_next_report_run_month_end.sql` was applied with
  bounded timeouts and verified for monthly leap/non-leap and weekly scheduling.
  The hosted ledger has 49 entries. Database and application automation remain OFF.
- Before activation: 871 Node 24 tests, lint/typecheck/build, database lint, 33 pgTAP
  assertions, 16 SQL regression files, and 14 local browser acceptance checks passed.
- Three callback CodeQL alerts were individually triaged as false positives using
  static evidence; other alerts were not dismissed. Application/database and security
  CI passed on the release SHA and the later monitoring-only commit.

## Release evidence

- Held candidate smoke passed before promotion:
  https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/39035042066
- Canonical smoke passed after promotion:
  https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/39035148396
- Permanent monitor configuration and canonical smoke passed:
  https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/39035345397
- Final observation smoke passed:
  https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/39037074114
- Operational monitoring commit: `821940f` on PR #7. It adds the optional protected
  workflow setup, credential-safe monitor script, documentation and example variable
  names. Nine focused tests and lint passed; application/database/CodeQL CI passed.
  The application deployment remains pinned to `723ad87`; PR #7 remains open.

Smoke checks verify exact release identity, configuration/database readiness, public
pages, redirect behavior and security headers. Vercel's native TypeCheck and Lint
gates both succeeded and blocked domain assignment until completion. Evidence
artifacts are retained by GitHub for 90 days.

## Permanent monitoring

Same Better Stack account, three-minute effective check interval, email enabled:

| Monitor | ID | URL |
| --- | --- | --- |
| Availability | `5086284` | `https://www.fixxflow.app/api/health/live` |
| Database readiness | `5086296` | `https://www.fixxflow.app/api/health/ready` |

Both monitors verify expected health content, TLS, and do not follow redirects.
The readiness credential is held in GitHub's protected secret storage and the
monitor's Authorization header. The setup script does not print credentials.

A temporary monitor deliberately expected absent content from the healthy public
endpoint. Better Stack detected it, generated email alerts, and the owner confirmed
delivery to the account inbox. It recovered, both incidents resolved, and the
temporary monitor was removed. Permanent monitors were not disrupted.
This validates routing and observed detection for the drill, not a future uptime SLA.

## Recovery and observation

Latest completed provider physical recovery point: `2026-10-17T11:36:08.659Z`.
Eight completed daily points were visible, with rolling retention around seven days;
WAL-G enabled, PITR disabled. The 24-hour RPO remains dependent on continued successful
daily backups. The physical restore and full four-hour RTO remain unverified.

Hosted logical recovery passed, including 90-table integrity comparison, exact grants,
RLS and trigger checks, local app reconnection, synthetic ticket, Storage bytes, and
fresh MFA. See `docs/recovery-drills/2026-10-17-hosted-logical.md` for limitations and
the required recovery procedure corrections. Production had no object bytes to recover.
After retaining evidence, the owner approved deletion of the disposable project.
Supabase accepted deletion at 13:40 UTC; the target disappeared from inventory and
production remained `ACTIVE_HEALTHY`. The Gmail pilot account remains active.

Production observation covered 13:05–13:36 UTC. Final Vercel runtime-error and HTTP
5xx queries returned zero records, and the final canonical smoke passed. Both
permanent monitors were UP at 13:36 UTC with zero open incidents. This low-traffic
window does not establish a statistically meaningful latency or Core Web Vitals
baseline. Sanitized machine-readable evidence is retained in
`docs/pilot-release-2026-10-17-results.json`.

## Remaining items

- Retain physical-backup recovery as an explicit open gate; do not claim the logical
  rehearsal proves it. Product owner decides the acceptable pilot risk.
- Review/merge PR #7 through normal protected-main checks when authorized.
- Address the owner's UI/UX and notification-presentation feedback after checks.
