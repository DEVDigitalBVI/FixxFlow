# Pilot release handoff — paused at the owner's request

Paused on 17 October 2026 UTC (16 October in America/Tortola). The owner requested
that work continue tomorrow. Do not resume deployment or testing until requested.

## Completed

- Pinned clean commit `723ad87ffac09087fd9f7067b9f5ff5ff269e177`; application and
  database CI and CodeQL analysis passed.
- Reviewed CodeQL alerts 44, 43 and 42 individually using static evidence. All three
  are false positives: request parameters select a protocol, while Supabase token
  verification and downstream JWT/MFA/membership checks enforce access. Recorded
  the rationale and dismissed those specific alerts. PR #7 then reported `CLEAN`
  with the separate CodeQL security check successful. Other alerts were not dismissed.
- Refreshed the expired Vercel CLI session. Independently identified the canonical
  site's last verified deployment as `dpl_FFAKztESuPG3k8BCp6aKb9VN7myq`, commit
  `ccb52ced264da5ba31d4f58868715027008bbfd3`.
- Captured the current hosted Auth configuration privately and refreshed the daily
  backup inventory. Latest completed provider backup: `2026-10-16T11:39:05.413Z`;
  PITR is disabled.
- Saved the old report function and privileges, then applied exactly
  `20261016120000_fix_next_report_run_month_end.sql` using the normal CLI with
  bounded lock/statement timeouts, no seeds/roles, and Vault synchronization skipped.
  Production now has 49 migrations. Read-only verification returned February 28
  and leap-day February 29 correctly, plus the expected next weekly date.
- Verified the production database automation gate remains OFF.
- Built commit `723ad87` with production configuration using `--skip-domain`.
  Held candidate: `dpl_5LUY1r6nF6xnW3tMg5vvR9qvbM56`,
  `https://fixx-flow-4ygpbxais-fixx-flow.vercel.app`. It is READY and protected.
  Its liveness check returned 200. Production custom domains were not promoted by
  this session. The standard project Vercel alias was assigned by the CLI.
- Vercel CLI generated a deployment-protection automation bypass for the protected
  liveness request. It was not copied into GitHub secrets yet.
- Obtained explicit approval for a disposable hosted logical recovery drill at the
  quoted $10/month base rate while retained, plus possible usage charges, in the
  existing organization. The owner understands that physical-backup validation
  remains open.
- Created `twxpybtezuposrmrekud`, **FixxFlow isolated recovery 2026-10-17**, in the
  existing organization and `us-west-2`, starting at `2026-10-17T03:04:39.726Z`.
  Completed a read-only production schema export. No production data has been
  restored to this disposable project yet.

## Important: disposable project billing

On pause, attempted to pause only the disposable recovery project. Supabase rejected
the request because this paid project cannot be paused. It remains provisioned at
the approved rate. Do not downgrade the organization or delete the project without
the owner's cleanup instruction. Production was not paused.

## Still to do

1. Verify the held candidate's native checks and run protected readiness, exact SHA
   and full security-header smoke before promotion. Vercel's sensitive health secret
   cannot be read back through its environment API. Use the existing GitHub
   `Deployment smoke` workflow and `Production` environment secret instead. It
   supports `release_sha=723ad87ffac09087fd9f7067b9f5ff5ff269e177` even when dispatched
   from `main`. The protected candidate also needs an automation bypass; reuse the
   existing project bypass and store it securely as the `Production` environment's
   `VERCEL_AUTOMATION_BYPASS_SECRET` without printing it.
2. Promote only the verified production candidate, then update **Invite user** in
   hosted Supabase Auth from `supabase/templates/invite-user.html`. The template has
   **not** been changed yet; applying it before the callback is live would break
   new invitations on the previous application.
3. Send the authorized pilot invitation and notification tests. The owner supplied
   a fresh Gmail recipient for the invitation and their existing administrator
   inbox for notifications; use the addresses in the conversation. No test emails
   or new production invitations have been sent in this session. Never generate an
   administrator login link to impersonate the owner. The owner must accept the
   invitation, choose a password and confirm sign-in/delivery.
4. Complete the hosted logical restore in the disposable project with email and
   processing disabled, no cron schedule imported, schema/data/permissions/MFA and
   migration-ledger checks, isolated app reconnection and smoke. Include Storage
   recovery evidence separately. Do not claim the physical backup was restored.
5. Configure independent monitoring. The owner has no existing uptime account.
   Suggested Better Stack's free three-minute tier and requested a team API token
   in `.env.local` as `BETTER_STACK_UPTIME_API_TOKEN`, never in chat. No external
   monitor account or monitor has been created. The owner paused instead of doing
   this setup. Existing GitHub scheduled health checks remain delayed; their cron
   declaration alone does not establish the 25-minute detection objective.
6. Retain a release record, observe production for 30 minutes, and leave automation
   processing disabled. Do not certify pilot readiness while gates remain open.

## Private continuation files

These paths contain private configuration or credentials and must never be committed,
printed, or pasted into chat. Temporary paths can disappear; re-read/reconcile provider
state if needed rather than blindly repeating mutations.

- `/private/tmp/fixxflow-release-activation/`: baseline Auth config, backup inventory,
  old report function, clean release manifest and sanitized Vercel inventory.
- `/private/tmp/fixxflow-hosted-recovery-20261017/`: target identity, private password,
  start time and production schema export.
- `/private/tmp/fixxflow-release-management.mjs`: targeted Auth inventory/template
  update and report-function snapshot helper. Never run its `template` mode until
  the corrected callback is live.
- `/private/tmp/fixxflow-release-vercel.mjs`: correct-team Vercel metadata helper.
- `/private/tmp/fixxflow-release-smoke.mjs`: incomplete local smoke helper; health
  secret retrieval is intentionally unavailable for the sensitive variable. Prefer
  the existing GitHub workflow rather than weakening secret protection.
- `/private/tmp/fixxflow-recovery-create.mjs`: creation helper. **Do not rerun**:
  target already exists. Inspect the saved target first.

Security triage artifact was saved through the Codex Security artifact tool as
`artifacts/release-codeql-triage-2026-10-17.json` in its target-bound collection.

The source branch remains `codex/design-consistency-launch-audit`; PR #7 was not
merged. No new source changes beyond this handoff were made during activation.
