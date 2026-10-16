# Hosted backup inventory — 2026-10-16

This is read-only evidence for the FixxFlow production Supabase project. No restore,
database write, configuration change, or new hosted project was performed.

## Observed provider state

- Project status: `ACTIVE_HEALTHY`
- Region: `us-west-2`
- PostgreSQL: `17.6.1.166`, GA channel
- Backup mechanism: physical backups with WAL-G enabled
- PITR: disabled
- Newest completed recovery point: `2026-10-16T11:39:05.413Z`
- Oldest visible completed recovery point: `2026-10-09T11:46:01.906Z`
- Inventory: eight consecutive completed daily recovery points; no failed point was
  returned by the Management API

The observed interval supports the approved 24-hour RPO while daily backups continue
to complete. It does not guarantee recovery time, prove backup contents, or cover
Storage object bytes and provider configuration.

## Restore decision

A provider restore-to-new-project was not started. Supabase restores the full physical
database and immediately starts extensions capable of external work, including
`pg_cron`. FixxFlow has a scheduled `fixxflow-sla-notifications` job, so an unmodified
physical clone could enqueue work from copied production data. The clone also creates
an independently billed project.

The safe hosted rehearsal requires explicit cost approval and a reviewed isolation
procedure. Until then, the four-hour hosted RTO remains unverified. The complementary
logical PostgreSQL 17 rehearsal is recorded in `2026-10-16-local.md`.
