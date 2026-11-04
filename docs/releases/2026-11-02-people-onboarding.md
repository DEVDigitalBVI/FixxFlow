# People onboarding and organization layout release — 2026-11-02

Production commit: `f1054b09a861c2f237d2d59e6636968673623caa`.
Deployment: `dpl_A2eKUCwbCnfNVwHXGMUuZxcpqyrK` at
`https://fixx-flow-ai16syuvm-fixx-flow.vercel.app`, promoted to `https://fixxflow.com`.

The product owner requested deployment to Vercel and retains release, incident,
rollback and recovery decisions. Codex executed the authorized deployment.
No GitHub push was performed; this was a direct Vercel CLI release.

## Changes

- People show Invited until account setup completes, green Active after setup,
  and Inactive for disabled workspace access. Directory status reads are bounded,
  staff-only and workspace-scoped; Auth credentials are never returned.
- Departments and locations share readable row layouts and grouped lifecycle actions.
- Invitation sending reports the Auth email allowance accurately and stops immediately
  on throttling while preserving successful and unsent rows.

## Verification and recovery

- All 1,362 application and embedded PostgreSQL tests passed under Node 24.
- Repository lint and formatting passed. Desktop/mobile, light/dark visual checks and
  targeted accessibility, failure-recovery and authorization checks passed before release.
- The exact held candidate and canonical production URL passed the repository smoke
  script, including protected database readiness, expected release identity, redirects,
  login and security headers. Safe evidence is retained in the adjacent directory.
- The migration dry run found only `20261102155313_member_directory_account_status`.
  It was applied and verified in the production ledger. It adds read-only functions;
  no customer rows or access grants were rewritten. Anonymous execution is denied.
- Latest completed physical backup before migration: `2026-11-02T11:42:31.305Z`.
  Eight daily points were available; PITR was disabled. The existing October 17 hosted
  logical restore rehearsal is within 90 days; its documented limits still apply.
- Last known-good compatible deployment: `https://fixx-flow-ljpcdpnii-fixx-flow.vercel.app`,
  release `ee5d623d780cefedf7e5fe4041a9d0818a339cf3`. The additive migration remains
  compatible with that version for rollback.
- Production environment settings were reused; no authentication, SMTP, automation or
  security configuration was changed by this deployment.
- This direct deployment used local verification and the Vercel build rather than a new
  GitHub CI/CodeQL run. No completed 30-minute observation or authenticated browser
  acceptance is claimed. Existing independent production monitors remain in place.

## Result

Promoted successfully after held-candidate verification. Post-promotion smoke passed.
At verification, directory source data classified 40 accounts as Active and 12 as Invited.
