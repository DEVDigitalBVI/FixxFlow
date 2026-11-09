# FixxFlow

FixxFlow is built with Next.js, React, TypeScript, and Supabase.

The supported runtime is Node.js 26.x. TypeScript remains pinned to 5.9.3 because
the current lint tooling does not support TypeScript 7. Supabase CLI remains pinned
to 2.122.0 pending a separate migration of database target flags and configuration.

## Local development

1. Install Node.js 26.x.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key from the Supabase Connect dialog.
3. Install the locked packages with `npm ci`.
4. Start the app with `npm run dev`.

## People deletion

Workspace invitations use migration `20261104151250_invitation_acceptance_window.sql` and a separate 72-hour, single-use FixxFlow link. Invitation emails now use the existing Resend configuration (`RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SECRET_KEY`); account registration completes before any email is sent. Pending People entries expose Send new invitation, which preserves idempotent retries and replaces previous links after the provider accepts the new email. Acceptance requires an explicit POST, checks active workspace membership and the stored token hash, and generates a fresh Supabase invitation token only then. Confirmed accounts cannot reuse invitations as password recovery. Normal email recovery and confirmation expiry stays at 24 hours (`auth.email.otp_expiry = 86400`).

Deploy the application routes before updating Supabase’s reset-password email template to `supabase/templates/reset-password.html`; its link now opens `/auth/recovery` and verifies only after an explicit Continue action, without depending on the requesting browser’s PKCE cookie. Existing email links retain their original provider token behavior. Apply the reviewed password policy (`lower_upper_letters_digits_symbols`, minimum 8) alongside the application checklist. The checklist uses the same rules in the browser and server; common/exposed-password screening remains with Supabase and is explained separately. Rejected weak passwords now receive an actionable message instead of an instruction to resend the email. The local synthetic preview is `/?surface=password-requirements&role=employee`; it does not send or save a password.

Employee support insights require migration `20261104140743_support_viewers.sql` before deploying this application. In People → Manage → Support insights, administrators can grant employees independent dashboard and Shared incidents permissions. IT staff publish curated titles, overviews and resolution summaries from a ticket’s coordination tools. Only explicitly published incidents or High/Urgent tickets appear to viewers; raw ticket, conversation, note and attachment access is unchanged. Clear Publish and save to withdraw a summary, or revoke a person’s permissions in People. The local interface fixture includes synthetic previews at `/app/support-dashboard?role=employee`, `/app/shared-incidents?role=employee`, `/?surface=support-permissions` and `/?surface=support-sharing`; run `node tests/helpers/interface-audit-preview.mjs 4197`. Preview submissions do not change workspace data.

People deletion requires migration `20261101151101_workspace_people_deletion.sql` before deploying the updated application. It removes workspace access and directory entries, preserving login identities and linked history. Administrators can delete other members; technicians can delete employees only. Individual and page-level bulk deletion require confirmation, block self-deletion, and audit each removed person. The migration adds a deletion timestamp; deleted memberships must stay inactive and cannot be restored through the ordinary Activate action.

## Project structure

- `src/app` — Next.js routes, layouts, and route handlers
- `src/components` — reusable interface components
- `src/features` — domain-oriented product modules
- `src/lib` — infrastructure and service clients
- `src/types` — shared and generated TypeScript types
- `tests` — shared test helpers and fixtures; feature tests live beside their source
- `scripts` — development, release, and operational commands
- `content/knowledge` — curated knowledge article sources
- `public/brand` — approved brand assets, fonts, and licenses

- `supabase/migrations` — versioned database schema changes
- `docs` — indexed architecture, feature guides, operating procedures, and release evidence

The local `brand/fixxflow` handoff folder is generated and ignored by Git. After changing approved assets, run `npm run brand:sync` to refresh every logo, icon, source master, font, token file and manifest. Run `npm run brand:check` to verify that the handoff package matches the approved files byte for byte.

## Documentation

Start with the [documentation index](docs/README.md). Keep implementation rules in
`AGENTS.md` and the authoritative design specification in `DESIGN_SYSTEM.md`.

- [Design system](DESIGN_SYSTEM.md): authoritative UI requirements and shared interaction patterns.
- [Architecture](PLATFORM_ARCHITECTURE.md) and [code review](docs/architecture/code-review.md): application boundaries, implementation history, and outstanding engineering/product work.
- [Automation rollout](docs/automation/rollout.md): deployment status, release gates, recovery, and links to stage-specific runbooks.
- [Production readiness](docs/operations/production-readiness.md), [release record](docs/operations/release-template.md), and [incident response](docs/operations/incident-response.md): application-wide deployment gates, staging, monitoring, rollback, and recovery.
- [Notifications and email](docs/features/notifications.md), [inventory](docs/features/inventory.md), and [asset import](docs/features/asset-import.md): setup and operational behavior.
- [Knowledge base](docs/features/knowledge-base.md), [search](docs/features/search.md), [reporting](docs/features/reporting.md), [analytics](docs/features/product-analytics.md), and [audit log](docs/features/audit-log.md): domain behavior and validation.

## Supabase types

With the local Supabase stack running, regenerate database types with:

```sh
npm run db:types -- --local
```

Use `npm run db:types` to read the linked project instead. The generator captures successful output before replacing the file, so a CLI or authentication failure preserves the existing types.

`database.generated.ts` contains generated schema and relationships. Keep domain aliases,
CHECK-constraint refinements, and trigger-populated insert fields in `database.ts`;
regeneration must not overwrite that wrapper. The current snapshot was generated
read-only from the FixxFlow project on 27 September 2026. Regenerate from a fully
migrated local database and run typecheck/tests before accepting future changes.

Never expose a Supabase secret or service-role key through a `NEXT_PUBLIC_` variable.

### Ticket categories

Apply `20260925010356_starter_ticket_categories.sql` through the normal migration workflow to seed Account / Access, Computer, Email, Network, Printer, Software, Security, Phone, and Other. New organizations receive these nine categories automatically. Existing organizations receive missing defaults; custom and legacy categories (including Hardware and Access), inactive settings, and ticket references are preserved.

Employees can optionally choose a category when requesting support. Staff can categorize tickets on creation and in ticket details. Subcategories appear only when configured beneath the selected category; changing the parent clears the child selection. Existing inactive classifications remain visible on historical tickets.

Administrators configure category default teams under Administration → Categories.
New employee/equipment requests use the active default; staff can use automatic
routing, choose a team, or leave a request unassigned. Changing defaults does not
reroute existing tickets. Ticket history records automatic routing with the team
name captured at creation; inactive categories/teams receive no automatic assignments.

Later phase: administrator-managed Category → Subcategory → Issue Type. Keep tenant-scoped IDs and parent-child constraints for analytics and automation; archive used values instead of deleting history. Category and Subcategory tables exist today. The Issue Type model, administrator editor, and analytics/automation rules are future work.

### SLA tracking

Tickets snapshot the organization’s support schedule, timezone and priority targets. Deadlines count saved working hours; manual due dates remain separate. Public staff replies satisfy response. Starting work on a technician’s self-assigned request satisfies response acknowledgment and is labeled separately from a public reply. Assignment and internal notes alone do not satisfy response. Work starting or a public reply also records IT acknowledgment for reporting.

Waiting on user and documented On hold states pause resolution only. Holds require an owner, a reason (vendor, parts, approval or scheduled work), a requester-visible explanation, and a future follow-up date. Review dates flag overdue holds without automatically resuming them. A requester reply resumes Waiting on user, while vendor and other holds require an explicit staff action. Resuming retains the remaining allowance and any pre-hold breach. Holds must be documented individually; bulk status updates and new automatic status actions cannot create undocumented holds.

Apply `20261109161826_ticket_acknowledgment_and_controlled_holds.sql` first (the notification enum change must commit), followed by `20261109162844_controlled_ticket_sla_workflow.sql`, before releasing the application. These migrations do not backdate acknowledgment or pause existing On hold tickets. Staff must document existing holds; missing follow-up dates appear in the review queue. Existing automations that attempt to place tickets on hold without required details will fail validation in the database and must be replaced with an individual staff review.

The existing notifications cron enqueues hold review reminders, deduplicated by ticket, review date and recipient. Reviewing/resuming/reassigning a hold skips obsolete pending reminder email. Notification preferences continue to apply. SLA outcomes, acknowledgment time, resolution support time, total turnaround and recorded paused elapsed time are reported separately; the exports contain these distinctions. Historical pauses are not reconstructed, and old calendar-policy resolution samples are excluded from support-time averages.

Warnings begin in the last 20% of a target, capped at 30 minutes. SLA indicators refresh every 30 seconds and on window focus. Queue filtering, SLA sorting, and dashboard counts use the indexed next unfinished deadline; overdue hold reviews have their own queue filter.

Run `npm test` for PostgreSQL migration/lifecycle/permission tests and UI interaction tests. The transactional SLA regression is `supabase/tests/sla-regression.sql`; it creates temporary test fixtures and rolls them back.

### Security and database verification

See the [Automation rollout runbook](docs/automation/rollout.md) for recorded
migration deployments and release gates. Historical preflight reports describe
their verification date; they do not establish the current state of a database.

`20260925010358_enforce_mfa_and_server_owned_timestamps.sql` enforces verified MFA factors across all application tables, Storage and Realtime. Accounts without a verified factor can still use AAL1; enrolled accounts require AAL2. Authenticated callers cannot provide ticket/chat system timestamps or SLA completion fields. It also serializes administrator demotions and indexes chat foreign keys.

Run `npm run format:check`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Use `npm run format` to apply the shared Prettier and import-order rules. Generated files are excluded. Run `supabase test db` against a local stack for the pgTAP suites, plus the transactional `supabase/tests/security-regression.sql` and `supabase/tests/sla-regression.sql` using the SQL runner. All fixtures roll back. Production verification should use the same transactional isolation and must not send invitations or recovery emails.

Production Auth uses `https://fixxflow.com`, confirmed email signup, an eight-character minimum, and leaked-password protection. Leaked-password protection is managed in the hosted Auth dashboard. Keep `NEXT_PUBLIC_SITE_URL` aligned with this domain. The server secret is required for organization bootstrap, invitations, and queued notification delivery; never expose it to the browser.

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

The GitHub Checks workflow runs Node 26, lockfile installation, production dependency
audit, lint, generated route types, typecheck, unit/component tests, the production
build, and the production proxy check. Its isolated database job starts the local
Supabase stack and runs database lint, pgTAP, and every transactional SQL regression.
It uses synthetic local data and never links to or mutates a hosted project.
