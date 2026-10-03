# Code structure and efficiency review

Original review: 27 September 2026. “Next” audit follow-up: 3 October 2026.

## 3 October follow-up: the complete “Next” phase

The original audit grouped four items under **Next**: lookup pagination, failure handling, draft preservation, and telemetry. All four are implemented locally. The lookup migration is applied; application deployment is pending.

| Item | Fix | Main implementation |
| --- | --- | --- |
| Lookup scalability | Searchable 50-choice keyset pages for people, technicians, teams, departments, locations, categories, and dependent subcategories. Fetch the current selection separately, including inactive selections. Ticket/chat display labels load only IDs on the visible page; asset labels load only the selected IDs. | `src/features/lookups/`, `src/features/tickets/data.ts`, `src/features/assets/options.ts` |
| Failure handling | Membership/database outages no longer become onboarding redirects or empty profile/reference values. Failed or unresolved lookups preserve selections and block affected mutations. A root retry boundary covers viewer failures raised by the workspace layout. | `src/lib/auth/viewer.ts`, `src/app/error.tsx`, profile/ticket/asset/chat actions |
| Draft preservation | Ticket detail, profile, and chat assignment return recoverable action results through the existing `ActionForm`. Failed validation or saves keep controls mounted and focus the error summary. Existing asset draft/cancel behavior remains intact. | `src/components/ui/action-form.tsx`, affected editor routes/actions |
| Telemetry | Central structured server logging records an operation, allowlisted error code, and correlation ID. Notification batches share a reference; lookup/export failures return references. Raw errors, messages, request bodies, tokens, and personal data are excluded from log payloads. Export database failures retain their code for logging. | `src/lib/server-errors.ts`, notification/lookup/export routes |

The new picker is used in ticket creation/detail/bulk assignment/team filtering, asset creation/editing, profile references, and chat assignment. Other administrative editors and chat-to-ticket linking are unchanged; this is not a claim that every dropdown has been migrated. Formatting/extraction, service/browser CI, and additional runtime payload validation remain in the roadmap's **Following** phase.

### Rollout and recovery

Applied `supabase/migrations/20261003172406_paginated_reference_lookups.sql` once on 3 October 2026 to the linked FixxFlow project `dhuikxkrokowvnvzpihp`, following the user's deployment instruction. The remote history records version `20261003172406`; a subsequent isolated dry run reports no pending migrations. The deployed function body matches the local migration (MD5 `9055b6e879f02dbe61575855bd427335`). Verified invoker rights, empty search path, authenticated execution, denied anonymous execution, and zero results without membership for all seven resource types. Security advisors are unchanged from the pre-deployment baseline.

The lookup deployment used an isolated migration directory to apply only that migration. The two remaining automation migrations were subsequently applied under the user's separate instruction, as recorded below. No migration-history repair, application deployment, email send, or business-record mutation was performed. The additive lookup RPC can remain in place if the application release is rolled back.

### Remaining migration deployment — 3 October 2026

Applied `20261002202406_automation_guardrails.sql` followed by `20261003005804_automation_guardrails_corrections.sql` to FixxFlow `dhuikxkrokowvnvzpihp`. These supply the current automation code's capacity limits, fair claiming, legacy-definition compatibility, and safety-outcome reporting. The CLI used `--include-all` because these versions precede the already applied lookup migration, with vault/seed/role changes excluded and session options for a 5-second lock timeout and 120-second statement timeout. No original migration was edited.

- **Complete:** all 42 repository migration versions are applied; final CLI dry run returns `upToDate: true` and no pending migrations.
- **Verification:** 457 automation tests passed before deployment. All 17 affected final function bodies match the local SQL; the corrected definition CHECK is validated. The new schedule contains one row for the existing organization. Rule/version/execution/event/ticket counts remain zero, and the processing-state digest is unchanged.
- **Processing stays OFF:** worker claim returns zero; temporal discovery returns `disabled: true`, zero examined, zero emitted. Verification ran in a rolled-back transaction. No cron/environment setting, activation cutoff, or processing generation was changed. Hosted active-processing and accessibility release checks remain separate from this schema deployment.
- **Permissions:** both new private tables have RLS and no direct public/anon/authenticated/service-role read grants. Advisors report only informational [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), now 13 rather than 11 because these two deliberately private tables were added; no warning/error finding was returned.
- **Recovery:** a fresh owner-only custom database archive was created outside Git at `/Users/devdigitalbvi/FixxFlowBackups/pre-guardrails-20261003T175324Z/database.dump` (1,290,640 bytes; SHA-256 `e687517510ecbc6214a5ab08fa7ea94c57246dfb9b6b1a3e65e9fb3d94709fc7`). Full decode verification passed; no restore was performed. The existing backup was preserved. The latest listed completed provider physical backup is `2026-10-03T11:39:56.286Z`; PITR is off. Database archives do not include uploaded Storage file bytes or deployment configuration.

### Follow-up verification

- Final local checks: **749 tests passed, zero failures**; ESLint, TypeScript, production Next build, production proxy verification, and `git diff --check` passed.
- PostgreSQL regression coverage loads all repository migrations in PGlite and traverses 1,205 people with duplicate labels, no omitted/duplicated IDs, and an out-of-page current selection. Checks also cover literal punctuation, inactive choices, dependent categories, cross-tenant access, employee directory restrictions, MFA, and function grants. Supabase Auth claims are fixtures; this does not exercise a deployed PostgREST/Auth stack or establish production performance.
- Regression tests cover scoped display IDs, lookup errors/cancellation/retry, membership outages, guarded mutations, failed ticket/profile writes, and safe correlated diagnostics. The obsolete in-memory category filtering module was removed; database and dependent-picker tests cover the replacement behavior.
- The isolated Safari fixture uses real shared picker/form components and mocked data/saves. Desktop, 768px tablet, 390px compact, and 200% zoom checks passed. Verified keyboard selection, Enter search without form submission, clear-search focus restoration, paging with a retained selection, and error focus with retained drafts. Existing tokens, native fields/buttons, `ActionForm`, and `SubmitButton` were reused; the picker introduces no animation and follows existing reduced-motion styles. No deliberate design-system exception.
- Authenticated end-to-end browser flows and a screen-reader session were not run. The fixture is available at `tests/helpers/lookup-ui-preview.mjs`; it does not connect to the database or save real records.

## Assessment

Keep Next.js App Router, React, TypeScript, and Supabase. Feature folders, server-rendered routes, small interactive components, tenant-scoped queries, and database-enforced invariants provide a suitable foundation. A framework replacement would not address the data-loading and maintainability issues found here.

The repository-wide dependency inventory covered application modules, Next entry points, and the asset-import worker. All 147 application modules in the initial inventory were reachable from application entry points; 33 were client modules. There are 25 migration files (correcting the earlier report's count of 26). Detailed review concentrated on data loading, mutations, shared infrastructure, feature models, realtime/polling, tests, and reporting/search/platform SQL. This is not a claim that every declaration or CSS rule is necessary, an exhaustive security audit, or a production benchmark.

## Implemented

| Area | Change and effect |
| --- | --- |
| Unnecessary queries | Employee ticket lists skip staff profile/team requests. Employee chat lists skip staff profiles. Chat intake returns before queue queries. Regression tests cover these paths. |
| Conversation history | Ticket, chat, and linked-chat previews load the latest 50 records in descending timestamp/ID order, then display messages chronologically. New history routes page messages, files, and staff ticket activity with stable `(created_at, id)` cursors. Microseconds are preserved. Signing is limited to the displayed file page. Author lookups in archives are limited to the displayed authors. |
| History visibility | Archives check the organization and parent requester, exclude internal notes for employees, and expose activity only to staff. Invalid cursors are rejected. Composer history links open in a new tab to preserve drafts. Database errors are distinguished from missing parents. |
| Refresh efficiency | Removed the duplicate client message query in chat; route data supplies messages. A shared hook coalesces bursts over 250 ms, suppresses overlapping background transitions, pauses hidden-tab refreshes, and reconciles on focus/reconnect. Ticket intervals changed from 8 to 30 seconds; connected chats reconcile every 60 seconds with shorter disconnected fallbacks. Subscription cleanup guards against late authentication completion. |
| Upload recovery | Ticket, chat, and avatar uploads release pending state in `finally`, prevent duplicate submissions, allow selecting the same file again, and reject empty files. Shared upload/registration handling removes files after confirmed rejected registrations. Lost responses, including returned network-error objects, preserve potentially committed files and request reconciliation before retry. Avatar updates detect missing profile rows. Cleanup remains best effort. |
| Database types | Added a generated schema snapshot with relationships; domain aliases and CHECK/trigger/nullability refinements remain in a small wrapper. Asset types derive from schema. People relationship queries no longer use `overrideTypes`. README generation instructions preserve domain contracts. |
| JSON contracts | Operational reporting and platform RPC payloads now receive runtime shape validation before rendering. Invalid data follows existing unavailable states instead of unchecked casts and rendering failures. |
| Pagination | Shared strict decimal-page parsing across lists, with each consumer's valid maximum retained. Malformed, unsafe, negative, and repeated parameters fall back to page one. |
| Domain definitions | Ticket actions validate against central status/priority mappings. Ticket detail and administration share application SLA targets; existing tests check SQL parity. Database deadline calculations remain authoritative. |
| Separation | Ticket queue query orchestration moved into a server-only feature module. Shared mutation feedback types no longer depend on client UI or asset-domain modules. |
| Small efficiency gains | Reused date formatters and aggregated product usage in one pass. Preserved labels, ordering, and zero totals. |
| Cleanup and checks | Shared TS/TSX test loader replaces duplicated loaders. Test discovery covers every source test folder. TypeScript enforces unused locals/parameters. GitHub Checks installs from the lockfile and runs lint, typecheck, tests, and build without production secrets. |

No framework, dependency, icon family, styling system, design token, database policy, or SQL migration was replaced. No changes were deployed.

## Remaining work requiring further evidence

1. **Migration reconciliation — resolved 1 October 2026.** Exact recorded SQL equality and application schema fingerprints were verified. The repository routing filenames now use production versions `20260926024852` / `20260926025012`, with SQL bytes unchanged. All 26 existing identifiers align; ten Automation migrations remain pending. No production history repair or migration was performed. See [the production preflight](automation-production-preflight.md) for the dry run and remaining backup requirement. The generated types alone are not proof of migration parity.
2. **Database regression and profiling.** Run the existing pgTAP and transactional SQL suites against a fully migrated local stack. Exercise archive queries with over 1,000 records and tied timestamps in PostgreSQL. Measure representative `EXPLAIN (ANALYZE, BUFFERS)` results before adding indexes or changing reporting RPCs. Neither Supabase CLI nor Docker was available in this environment.
3. **Lookup scalability — primary workflows addressed 3 October 2026.** See the follow-up above. Administrative lookup editors and chat-to-ticket linking remain unchanged; broader conversion and production profiling can build on the new shared picker/RPC.
4. **RPC scope.** `operational_report` computes daily/breakdown data even for summary-only callers. `platform_overview` returns organizations, usage, and audit data together for every platform section. Narrow or split these database contracts after measuring workloads and running database regressions; preserve owner/MFA checks.
5. **Browser confidence.** Exercise authenticated employee/staff flows on compact and wide screens: archive paging, keyboard focus, announcements, draft preservation, uploads/retry, reconnects, and refreshes during incoming messages. Hook and server-render tests are useful but do not replace browser/assistive-technology checks.
6. **Further decomposition and formatting.** Ticket detail, queue JSX, chat room, and article editor remain large. Extract focused presentation pieces when modifying those features. Avoid generic repository classes or global stores merely to relocate code. Split CSS by ownership only with visual coverage and preserve cascade order.
7. **Delivery coverage.** The new application CI workflow still needs its first GitHub run. Database and authenticated browser jobs need separately provisioned fixtures and services. It does not deploy or alter databases.

## Deletion boundaries

No orphan application module was identified. Removed code was duplicated infrastructure and unnecessary execution paths. Applied migrations, email templates, asset workers, theme initialization, and dynamically selected CSS remain legitimate runtime/deployment inputs. A claim that all unused CSS or assets has been removed would be unsupported.

## Verification

- Original baseline: 140 tests passed. First cleanup: 144. Current cleanup: 159 tests passed.
- Lint with zero warnings, strict TypeScript, production Next build, and whitespace checks passed locally.
- New tests cover a simulated 1,205-record cursor traversal with tied microsecond timestamps, history authorization/scoping and bounded signing, malformed query parameters and RPC payloads, refresh coalescing/visibility/cleanup, and upload failure/ambiguous-response recovery.
- The production build used the CI placeholder public Supabase settings. Local checks used the installed dependencies; GitHub's clean `npm ci` job has not run here.
- Existing design tokens, buttons, native fields/links, status announcements, conversation classes, and responsive layout classes were reused. Static markup and behavior assertions pass; responsive visual checks, live keyboard/focus tests, and screen-reader checks were not performed. No deliberate `DESIGN_SYSTEM.md` exception.
- Hosted access was read-only schema/type/migration metadata inspection. No live database fixtures, production query benchmarks, migration changes, or authenticated browser tests were run.
