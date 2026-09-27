# Code structure and efficiency review

Reviewed and updated: 27 September 2026.

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

1. **Migration reconciliation.** Read-only hosted metadata shows local routing migration versions `20260926024707` / `20260926024954` differ from hosted versions `20260926024852` / `20260926025012`. Names and routing columns correspond, but applied SQL equivalence has not been established. Compare exact SQL before renaming or repairing history. The generated types are a hosted snapshot, not proof of local migration parity.
2. **Database regression and profiling.** Run the existing pgTAP and transactional SQL suites against a fully migrated local stack. Exercise archive queries with over 1,000 records and tied timestamps in PostgreSQL. Measure representative `EXPLAIN (ANALYZE, BUFFERS)` results before adding indexes or changing reporting RPCs. Neither Supabase CLI nor Docker was available in this environment.
3. **Lookup scalability.** Several staff forms still load organization-wide assignment/profile options. Replace these with searchable paginated controls when implementing large-organization support. A silent dropdown cap would hide valid choices. Archive author queries are scoped, but all existing lookup screens have not been redesigned.
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
