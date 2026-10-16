# FixxFlow release record

Copy this file for each staging or production release. Use UTC timestamps. Do not paste
credentials, tokens, raw customer data, ticket bodies, or unredacted provider errors.

## Identity and ownership

- Release name/version:
- Environment:
- Commit SHA:
- Vercel deployment ID and URL:
- Release owner:
- Database recovery owner:
- Incident commander:
- Rollback decision maker:
- Planned window:
- User impact and maintenance notice:

## Change and compatibility

- Release notes / changed behavior:
- Known issues:
- Migration versions and hashes:
- Production ledger before/after:
- Old-application/new-schema compatibility confirmed:
- Last known-good compatible deployment:
- Feature gates and required OFF states:

## Evidence

- `Checks / application` run:
- `Checks / database` run:
- CodeQL / dependency review:
- Staging deployment-smoke artifact:
- Authenticated staging acceptance:
- Accessibility/responsive acceptance:
- Performance/error baseline:
- Environment/configuration review:

## Recovery

- Backup mechanism and latest recovery point:
- Retention and protected artifact location/checksum, if applicable:
- Expected RPO and data-loss window:
- Approved RTO:
- Latest disposable restore rehearsal, duration, and result:
- Storage/provider-configuration recovery evidence:

## Deployment and observation

- Deployer and start/end time:
- Migration result:
- Exact deployment smoke artifact:
- Promotion approval:
- Production smoke result:
- 30-minute observation result:
- Logs, alerts, cron, queue, email, and business-flow checks:
- Deeper post-deployment regression:
- User/support feedback:

## Decision

- Result: approved / halted / rolled back
- Decision time and owner:
- Rollback target and verification, if used:
- Follow-up issues and owners:
- Checklist lessons incorporated:
