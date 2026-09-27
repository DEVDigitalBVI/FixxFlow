# FixxFlow

FixxFlow is built with Next.js, React, TypeScript, and Supabase.

## Local development

1. Install Node.js 24.x.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key from the Supabase Connect dialog.
3. Install packages with `npm install`.
4. Start the app with `npm run dev`.

## Project structure

- `src/app` — Next.js routes, layouts, and route handlers
- `src/components` — reusable interface components
- `src/features` — domain-oriented product modules
- `src/lib` — infrastructure and service clients
- `src/types` — shared and generated TypeScript types
- `supabase/migrations` — versioned database schema changes

## Supabase types

With the local Supabase stack running, regenerate database types with:

```sh
npx supabase gen types typescript --local > src/types/database.generated.ts
```

`database.generated.ts` contains generated schema and relationships. Keep domain aliases,
CHECK-constraint refinements, and trigger-populated insert fields in `database.ts`;
regeneration must not overwrite that wrapper. The current snapshot was generated
read-only from the FixxFlow project on 27 September 2026. Regenerate from a fully
migrated local database and run typecheck/tests before accepting future changes.

Never expose a Supabase secret or service-role key through a `NEXT_PUBLIC_` variable.

### Ticket categories

Apply `20260925010356_starter_ticket_categories.sql` through the normal migration workflow to seed Account / Access, Computer, Email, Network, Printer, Software, Security, Phone, and Other. New organizations receive these nine categories automatically. Existing organizations receive missing defaults; custom and legacy categories (including Hardware and Access), inactive settings, and ticket references are preserved.

Employees can optionally choose a category when requesting support. Staff can categorize tickets on creation and in ticket details. Subcategories appear only when configured beneath the selected category; changing the parent clears the child selection. Existing inactive classifications remain visible on historical tickets.

Later phase: administrator-managed Category → Subcategory → Issue Type. Keep tenant-scoped IDs and parent-child constraints for analytics and automation; archive used values instead of deleting history. Category and Subcategory tables exist today. The Issue Type model, administrator editor, and analytics/automation rules are future work.

### SLA tracking (calendar-time V1)

Apply `20260925004643_ticket_sla_targets.sql` before deploying the SLA UI. It stores separate response and resolution deadlines on every ticket, including tickets created from chat. Existing tickets are backfilled from creation time and current priority; this cannot reconstruct historical priority changes. Historical closed tickets recover their resolution timestamp from activity when available, otherwise their close timestamp is used.

| Priority | First public staff response | Resolution |
| --- | --- | --- |
| Critical | 15 minutes | 4 hours |
| High | 1 hour | 8 hours |
| Normal | 4 hours | 24 hours |
| Low | 8 hours | 48 hours |

Both clocks start at creation and count calendar time, including nights, weekends, waiting-on-user, and on-hold time. Internal notes and requester replies do not satisfy first response. Priority changes recalculate unfinished targets from creation; completed targets stay fixed. Resolution stops on resolve/close, closing preserves an earlier resolution timestamp, and reopening resumes the existing resolution deadline without resetting first response. Manual due dates remain separate.

Warnings begin in the last 20% of the target, capped at 30 minutes. Counts update every 30 seconds and on window focus. Queue filtering, SLA sorting, and the technician dashboard use the indexed next unfinished deadline. Both objectives show met/missed outcomes and accessible exact deadlines in addition to colors.

Future business-hours support belongs in the database deadline calculator, with an explicit organization timezone, weekly schedule, holidays, and versioned policy snapshots. Existing deadlines should retain their original calendar policy rather than shifting when a new schedule is introduced.

Run the transactional SQL regression with `supabase db query --local --file supabase/tests/sla-regression.sql` after local migrations. It creates temporary test fixtures and rolls them back.

### Security and database verification

Read-only inspection on 27 September 2026 found two migration-version differences:
local `20260926024707_category_team_routing.sql` corresponds by name to hosted
`20260926024852`, and local `20260926024954_ticket_routing_insert_permission.sql`
to hosted `20260926025012`. Compare the applied SQL before reconciling these
filenames/history. Do not blindly reapply them or repair production history.
No migration history was changed during the code cleanup.

`20260925010358_enforce_mfa_and_server_owned_timestamps.sql` enforces verified MFA factors across all application tables, Storage and Realtime. Accounts without a verified factor can still use AAL1; enrolled accounts require AAL2. Authenticated callers cannot provide ticket/chat system timestamps or SLA completion fields. It also serializes administrator demotions and indexes chat foreign keys.

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Run `supabase test db` against a local stack for the pgTAP suites, plus the transactional `supabase/tests/security-regression.sql` and `supabase/tests/sla-regression.sql` using the SQL runner. All fixtures roll back. Production verification should use the same transactional isolation and must not send invitations or recovery emails.

Production Auth uses `https://www.fixxflow.app`, confirmed email signup, an eight-character minimum, and leaked-password protection. Leaked-password protection is managed in the hosted Auth dashboard. Keep `NEXT_PUBLIC_SITE_URL` aligned with this domain. The server secret is required for organization bootstrap, invitations, and queued notification delivery; never expose it to the browser.

### Delete or deactivate organization data

Administrators can deactivate/reactivate departments and locations or permanently delete unused entries from Organization settings. Delete opens an inline confirmation naming the entry and requires an explicit checkbox; Cancel returns to the section. Server actions recheck administrator access and organization scope, validate confirmation, and distinguish a missing row from a successful deletion.

`20260926022032_protect_organization_references_on_delete.sql` replaces the profile foreign keys' `ON DELETE SET NULL` behavior with `NO ACTION`. People therefore block department/location deletion; existing ticket and asset foreign keys also block location deletion, including historical or retired records. Deactivation preserves these links. Foreign keys arbitrate concurrent assignment/deletion; there is no check-then-delete race. Existing audit triggers record successful deletion. No rows are removed by the migration.

Run `supabase/tests/organization-deletion-regression.sql` in a transaction-capable SQL connection to verify unused deletion, linked-record protection, deactivation/reactivation, administrator-only access, tenant isolation, and auditing. All fixtures roll back. UI and server-action coverage is included in `npm test`.

### Conversation history and checks

Live ticket/chat pages display the latest 50 messages and files. The linked history
routes paginate messages, attachments, and staff ticket activity using a timestamp
and ID cursor, preserving microsecond timestamp precision. History links from the
message composer open in a new tab so the current draft remains mounted.

Ticket reconciliation runs every 30 seconds while visible. Subscribed chats use
realtime events with a 60-second reconciliation interval; disconnected chats retain
a shorter fallback. Focus and visibility changes reconcile promptly. Background
refreshes coalesce event bursts and avoid overlapping route transitions.

The GitHub Checks workflow runs Node 24, lockfile installation, lint, typecheck,
unit/component tests, and the production build. It uses placeholder public Supabase
configuration, requires no production secrets, and does not deploy or run migrations.
Database regression tests still require a separately provisioned local Supabase stack.
