# Incident response

## Severity and response targets

| Severity | Example | Acknowledge | Update cadence |
| --- | --- | --- | --- |
| SEV-1 | Broad outage, suspected breach, destructive corruption | 15 minutes | Every 30 minutes |
| SEV-2 | Major workflow unavailable, serious degradation, tenant-scoped exposure risk | 30 minutes | Hourly |
| SEV-3 | Limited defect with a workaround | One business day | At material changes |

The incident commander assigns an operations lead, communications owner, database
recovery owner, and scribe. One person may hold multiple roles for a small incident,
but command and authorization must remain explicit.

## First response

1. Confirm impact using health probes, Vercel deployment/log evidence, Supabase status,
   and safe user reports. Never reproduce destructive behavior in production.
2. Declare severity, UTC start time, affected tenants/workflows, release/deployment,
   and current customer impact. Open an incident record in the authorized tracker.
3. Contain: stop the affected feature or Automation gates, pause promotion/cron where
   authorized, revoke exposed credentials, or route traffic to the last known-good
   compatible deployment. Preserve receipts and immutable history.
4. Communicate acknowledgement and the next update time. Do not speculate or include
   customer data, secrets, private logs, or exploit details in broad channels.
5. Recover using `docs/production-readiness.md`. Database restore, credential rotation,
   destructive cleanup, or paid capacity changes require the named authority.
6. Verify canonical production smoke, authenticated critical workflows, error/latency
   recovery, cron/queue health, data integrity, and alert clearance before resolution.

## Evidence

Record correlation IDs, deployment IDs, commit and migration hashes, safe error codes,
timeline, decisions, commands, owners, monitoring graphs, recovery point, estimated
data loss, and verification results. Store sensitive evidence only in the approved
restricted system. Application logs deliberately exclude raw errors and customer data.

## Post-incident review

For SEV-1 and SEV-2, schedule a blameless review within five business days. Document
trigger, impact, detection, contributing factors, response timeline, what worked,
corrective actions with owners/dates, regression tests, monitoring changes, and updates
to release/recovery checklists. Feed user feedback and support volume into priority.
