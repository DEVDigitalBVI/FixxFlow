# Changelog

Release notes follow this file and the evidence record in `docs/operations/release-template.md`.

## Unreleased

### Added

- Employee portal: plain-language expected reply and resolution times on the request form
  and each request, and 1–5 resolution ratings with optional comments. Staff see ratings on
  the ticket and in history; Reports shows resolution satisfaction for the last 30 days.
- Platform console: audited organization summary exports (Excel, CSV, PDF) with account
  details and aggregate counts only, and a daily product-analytics retention cleanup with
  run history and an audited on-demand run.

- Application and dependency readiness gates, isolated Supabase database CI, and
  automated dependency update configuration.
- Liveness and authenticated database-readiness probes with deployment smoke evidence.
- Safe uncaught-request telemetry, baseline response security headers, and scheduled
  production health checks.
- Production-candidate release gates, rollback, disaster recovery, incident response,
  monitoring, communication, and post-deployment QA procedures.
- Durable GitHub incident issues for failed production health checks and documented
  evidence from the first disposable logical recovery drill.
