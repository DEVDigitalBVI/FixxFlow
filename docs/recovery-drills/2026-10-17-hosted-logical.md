# Hosted logical recovery drill — 2026-10-17

## Result and limits

Passed the hosted logical restore, data/permission comparison, application reconnection,
and synthetic browser checks. This does **not** validate a Supabase physical backup,
PITR, the complete four-hour production RTO, or recovery of existing Storage bytes.
Production had no Storage objects at the export point.

Source: `dhuikxkrokowvnvzpihp`, PostgreSQL 17.6.1.166. Disposable target:
`twxpybtezuposrmrekud`, PostgreSQL 17.11.0.003, same organization and `us-west-2`.
The owner explicitly approved the quoted $10/month base rate while retained, plus
possible usage. Target provisioning began before the owner's overnight pause; that
pause and pre-provisioning mean elapsed time is not an end-to-end recovery measurement.
The resumed export/restore/verification sequence finished around 13:33 UTC.

## Isolation

- No production restore, reset, user impersonation, cron activation, or data cleanup.
- Target signups disabled; SMTP points at `127.0.0.1:1`, with synthetic credentials
  and an `.invalid` sender. Email/password authentication was enabled only for the
  isolated authentication check; outbound SMTP remained blocked.
- No cron schedules copied. Target cron job count verified zero. Both database and
  application automation gates remained OFF.
- Source Vault secrets, production email credentials, and source signing keys were
  not imported into the target.
- The recovered application ran locally on port 3100 using target-specific keys.
  Its browser test allowed only localhost and the disposable project's hostname.
- Fresh synthetic users/workspace were added only after source-data comparison.
  Existing production MFA secrets were preserved as data, never used to authenticate.

## Verification

| Check | Result |
| --- | --- |
| Exported tables | All 90 matched, comparing every source column and sorted COPY rows |
| Migration ledger | 49 entries, latest `20261016120000` |
| Application tables | 36 public, 23 private |
| Public functions | 54 |
| Public/private/Storage RLS policies | 134; normalized definitions matched |
| Application triggers | 76 on both sides |
| Normalized table/function grants | 306 on both sides; zero missing or additional grants |
| Default privileges | 96 normalized entries matched |
| Public tables without RLS | Zero |
| Restored Auth users / MFA factors before fixtures | 2 / 1 |
| Storage buckets / objects at export | 4 / 0 |
| Recovered app smoke | Liveness, protected database readiness, redirects, login, security headers passed |
| Recovered browser | Synthetic password login, ticket creation, exact attachment bytes, fresh MFA enrollment/challenge passed |

The copied MFA factor's stored columns matched the backup. The fresh synthetic MFA
test proves the restored Auth/application challenge flow; it does not prove that an
existing user's copied factor can be challenged successfully.

## Procedure findings

1. The provider-owned `log_min_messages` parameter grant cannot be replayed by the
   managed `postgres` account. The first transaction rolled back. Both source and
   target already had that grant, so only this verified duplicate was omitted from
   a separate replay file; the original roles export was preserved.
2. Supabase's schema export omits custom policies on managed schemas. Four native
   Storage triggers already existed; 14 missing custom Storage policies were copied
   separately with an explicit `public, extensions` search path. Definitions matched.
3. New-project function defaults left 85 additional function grants after the schema
   replay. The restore was not accepted until those exact extras were revoked in
   the disposable target and the normalized grant comparison returned zero drift.
   Future drills must compare privileges explicitly; restoring rows alone is insufficient.
4. The newer Storage service added `lifecycle_configuration` and
   `lifecycle_configuration_generation` to `storage.buckets`. Both were NULL for all
   four buckets. Every original bucket column matched the source export.
5. The restore client's four-minute supervisor recorded a timeout alongside exit 0.
   No SQL error was logged. Independent sessions verified the complete committed
   state, all policies, data, grants, and application operation. Allow a larger client
   budget in future drills and reconcile persisted state before any retry.
6. There were no rule versions or visibility rows in this snapshot. The specialized
   logical transaction-visibility rebuild was not needed; processing remained OFF.

## Evidence and cleanup

Sanitized release evidence is recorded in `docs/pilot-release-2026-10-17.md`.
Private exports, credentials and detailed digests are held in the mode-0700 temporary
directory `/private/tmp/fixxflow-hosted-recovery-20261017/`, with sensitive files 0600.
They must not be committed or treated as a durable independent backup.

The paid target cannot be paused. Retain it only until the owner confirms cleanup,
as required by `docs/production-readiness.md`. The production Gmail pilot account
and its conversation/tickets are explicitly retained for the owner's UI/UX testing.

The physical-backup restore gate remains open because provider cloning starts copied
cron jobs immediately. This logical drill must not be substituted for that evidence.
