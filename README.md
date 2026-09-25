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
npx supabase gen types typescript --local > src/types/database.ts
```

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

The migration filenames match the live Supabase migration versions. Earlier MCP deployments assigned different timestamps from their original local filenames; the SQL was compared before renaming the local files. Do not reapply those old versions or repair the production history to the original names.

`20260925010358_enforce_mfa_and_server_owned_timestamps.sql` enforces verified MFA factors across all application tables, Storage and Realtime. Accounts without a verified factor can still use AAL1; enrolled accounts require AAL2. Authenticated callers cannot provide ticket/chat system timestamps or SLA completion fields. It also serializes administrator demotions and indexes chat foreign keys.

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Run `supabase test db` against a local stack for the pgTAP suites, plus the transactional `supabase/tests/security-regression.sql` and `supabase/tests/sla-regression.sql` using the SQL runner. All fixtures roll back. Production verification should use the same transactional isolation and must not send invitations or recovery emails.

Production Auth uses `https://www.fixxflow.app`, confirmed email signup, an eight-character minimum, and leaked-password protection. Leaked-password protection is managed in the hosted Auth dashboard. Keep `NEXT_PUBLIC_SITE_URL` aligned with this domain. The server secret is required for organization bootstrap, invitations, and queued notification delivery; never expose it to the browser.
