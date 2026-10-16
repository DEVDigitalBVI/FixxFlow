# Changelog

Release notes follow this file and the evidence record in `docs/release-template.md`.

## Unreleased

### Added

- Application and dependency readiness gates, isolated Supabase database CI, and
  automated dependency update configuration.
- Liveness and authenticated database-readiness probes with deployment smoke evidence.
- Safe uncaught-request telemetry, baseline response security headers, and scheduled
  production health checks.
- Production-candidate release gates, rollback, disaster recovery, incident response,
  monitoring, communication, and post-deployment QA procedures.
- Durable GitHub incident issues for failed production health checks and documented
  evidence from the first disposable logical recovery drill.
