# Documentation

## Product and development

- [Design system](../DESIGN_SYSTEM.md) and [platform architecture](../PLATFORM_ARCHITECTURE.md).
- Architecture: [durable ticket events](architecture/durable-ticket-events.md) and [code review and implementation history](architecture/code-review.md).
- Feature guides: [tickets and SLA](../README.md#ticket-categories), [knowledge base](features/knowledge-base.md), [search](features/search.md), [reporting](features/reporting.md), [notifications](features/notifications.md), [audit log](features/audit-log.md), [product analytics](features/product-analytics.md), [inventory](features/inventory.md), and [asset import](features/asset-import.md).
- Automation: [rollout](automation/rollout.md), [administration and templates](automation/administration.md), [storage contracts](automation/storage.md), [worker](automation/worker.md), [temporal processing](automation/temporal.md), [dry runs](automation/dry-run.md), [portability](automation/portability.md), [operations](automation/operations.md), and [guardrails](automation/guardrails.md).

## Operations and release evidence

- [Production readiness](operations/production-readiness.md), [release template](operations/release-template.md), and [incident response](operations/incident-response.md).
- [Pilot release](releases/2026-10-17-pilot.md) and [pilot verification](releases/2026-10-16-pilot-verification-results.json).
- Recovery drills: [local recovery](recovery-drills/2026-10-16-local.md), [hosted logical recovery](recovery-drills/2026-10-17-hosted-logical.md), and [hosted backup inventory](recovery-drills/2026-10-16-hosted-backup-inventory.md).
- Original machine-readable automation evidence is retained in `automation/evidence/`. Superseded narrative reports and pause handoffs have been removed; Git history retains their previous versions. Evidence can mention repository paths as they existed when the checks ran.

## File placement

Keep routes and Next.js entrypoints in `src/app`, product behavior in its existing
`src/features/<domain>` module, reusable UI in `src/components`, and shared
infrastructure or domain-independent utilities in `src/lib`. Colocate feature
tests with the code they exercise; put reusable fixtures and harnesses in `tests`.
Avoid moving modules merely to create more nesting.

Put product guides in `docs/features`, architecture notes in `docs/architecture`,
operating procedures in `docs/operations`, and automation guides in
`docs/automation`. Keep historical automation evidence in
`docs/automation/evidence`, release records in `docs/releases`, recovery records in
`docs/recovery-drills`, and operational SQL references in `docs/sql`.

## Naming

- Use lowercase kebab-case for hand-authored source files, feature folders, and guides, such as `ticket-details-form.tsx`. Keep feature tests beside their source with the `.test.mjs` suffix.
- Use date-first names for release and recovery records: `YYYY-MM-DD-description.md`. Keep associated result files beside the record with a `-results.json` suffix.
- Keep Next.js route groups, dynamic parameters, and reserved entrypoint names in their required forms. Preserve conventional root documents such as `AGENTS.md`, `DESIGN_SYSTEM.md`, and `README.md`.
- Preserve migration identities, generated filenames, licensed font names, and approved public asset paths. Historical test harness and evidence names retain their stage identifiers for reproducibility.

Update links, test fixture paths, workflow guidance, and knowledge article
`sourcePaths` when relocating referenced documents. Preserve original evidence,
database migrations, generated database types, and asset licenses.
