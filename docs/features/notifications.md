# Notifications and email

In-app notifications cover new tickets for every active company administrator, ticket assignment/reassignment, public responses, requester replies, new chats, chat responses, resolution/reopening, and approaching response/resolution SLAs. Internal notes and a person's own actions are silent, except intake and new ownership alerts. New assignees receive assignment email even when assigning themselves. Active staff receive unassigned conversations. Recipient access is checked through RLS, including enrolled MFA assurance.

SLA warnings run every minute through Supabase pg_cron, independently of email. The warning starts in the final 20% of the target, capped at 30 minutes, and is deduplicated per recipient/objective/deadline. Time remains calendar-based.

Automated notifications use the Resend API. Supabase Auth uses Resend SMTP for
account emails. The support inbox remains in Zoho Mail at `support@fixxflow.app`.
Notification replies go to that inbox; receiving a reply does not automatically
append it to a ticket.

## Queue behavior and configuration checks

The administration status screen and email endpoint share the same configuration check: all five settings are required, the application URL must use HTTPS without embedded credentials, and the sender must be valid. Incomplete or invalid configuration returns 503 before the endpoint claims queued mail; missing or incorrect cron authorization returns 401. In-app alerts continue working. “Configured” confirms settings, not provider health or successful delivery. Automated tests use mocks and do not send real email.

Emails use verified Supabase Auth addresses and include the event, ticket number and ticket name in the subject and heading, plus an authenticated application link. Ticket names are captured privately when queued, normalized to one line, and stay stable across retries. Already attempted messages retain their original payload. Conversation bodies are never included. Approved stakeholder updates retain their approved heading and body without disclosing the internal ticket name. Read alerts and unauthorized/inactive/unverified recipients are skipped. Creation and assignment/reassignment emails are sent even when the in-app alert has already been read; membership and verified-address checks still apply. Reply bursts share an email within a five-minute bucket; all events remain in the inbox. Delivery waits at least one minute, processes five emails per cron, uses five-minute queue leases, and retries up to six times. Events older than 24 hours expire. Notification preferences are deferred.

The private `notification_email_outbox` table records pending/sending/sent/skipped/failed state and sanitized failures. Failed mail never blocks ticket transactions. Monitor this table and Vercel cron failures when enabling email. Queue throughput and retention should be revisited as usage grows.

## Production email setup

1. Confirm `fixxflow.app` is verified in Resend. Keep open and click tracking off
   in the Resend domain configuration. These are provider settings, not send-API
   fields. Preserve Zoho Mail's root MX records. Resend's sending/return-path DNS
   records can coexist with the Zoho mailbox; do not enable inbound receiving or
   replace the mailbox MX records for this migration.
2. In Vercel Production, configure server-only `RESEND_API_KEY` with sending
   access to the verified domain. Keep
   `NOTIFICATIONS_FROM_EMAIL=FixxFlow <notifications@fixxflow.app>`, the existing
   `CRON_SECRET`, `SUPABASE_SECRET_KEY`, and HTTPS `NEXT_PUBLIC_SITE_URL`.
   For a new setup, generate a random `CRON_SECRET` of at least 32 characters.
   Check the actual production site URL rather than changing it during cutover.
3. In the hosted Supabase project's Authentication email SMTP settings, use:

   | Setting | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` (implicit TLS) |
   | Username | `resend` |
   | Password | Resend API key with sending access to `fixxflow.app` |
   | Sender email | `noreply@fixxflow.app` |
   | Sender name | `FixxFlow` |

   Preserve the branded Auth templates and their Supabase substitution tokens.
   The hosted dashboard settings govern production; local `config.toml` does
   not update the hosted SMTP configuration. Keep credentials out of source
   control, browser bundles, and chat.
4. Deploy the application change after the production API key is configured.
   The existing Vercel cron continues invoking `/api/cron/notifications` every
   minute. Incomplete configuration returns 503 before claiming queued mail.
   This schedule requires a Vercel plan supporting per-minute cron.
5. Use an authorized pilot recipient for one account-email test and one app
   notification test. Confirm both in Resend's email records and in the actual
   recipient inbox. Verify the notification reply-to reaches Zoho support, the
   app link opens the correct site, and the production cron returns 200.
   A provider acceptance ID alone does not establish delivery.
6. Production email configuration is Resend only. Remove obsolete sending
   variables from the deployment environment; retain support mailbox credentials
   and mailbox DNS. Existing failed/expired outbox messages are not automatically
   replayed by changing providers.

## Delivery and recovery

The existing queue, access checks, leases, bounded retries, templates, plain-text
alternative, and generic notification content are reused. The sender posts to
`https://api.resend.com/emails` and records the returned `id` only after a
successful HTTP response containing a nonempty ID. Provider error bodies are
not logged or shown to users.

Each notification uses `Idempotency-Key: notification/<notification_id>` across
retry leases. Resend retains keys for 24 hours. Retrying the same payload within
that window avoids another send after a lost response or queue acknowledgement.
A changed payload with the same key can receive a 409; investigate rather than
changing the key to force a potentially duplicate send. This is not a permanent
exactly-once guarantee. The existing queue expires events after 24 hours.

Outbox `sent` and Administration's “configured” indicator do not prove recipient
delivery. Bounce/delivery webhook reconciliation is not implemented. Use Resend
email records and recipient confirmation for the pilot acceptance check.

For application rollback, use a Resend-compatible release. Do not restore retired
sending credentials or automatically replay accepted messages through another
provider; cross-provider deduplication is not guaranteed.

## Branded templates

`src/features/notifications/template.ts` is the shared HTML email layout. It uses
the approved full primary logo, app typography stack, and design-system colors.
Inline styles and presentation tables support mail clients; a fixed light surface
keeps the primary artwork legible. Client-forced dark mode and font availability
can still affect rendering. The app uses system fallbacks when Inter is unavailable.

The layout uses a compact, proportional logo and a decorative blue-to-cyan top
rule (solid blue in clients without gradient support). Semantic email purposes
provide workspace, account access, security, and notification labels. Security
alerts place recovery guidance in a warning-tinted panel with a written heading;
actions remain solid blue. Utility links retain underlines and full fallback URLs.

Run `node scripts/generate-email-templates.mjs` to regenerate the 13 Supabase HTML
templates in `supabase/templates/`. Paste these into the corresponding hosted
Supabase Auth email template source editors. This does not enable disabled security
notifications. Invitations use `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite`
so the server can verify the one-use invitation and establish the cookie session
before password setup. Deploy the matching callback before updating the hosted
**Invite user** template. Default invitation `ConfirmationURL` links return their
session in a URL fragment and cannot be exchanged by the server's PKCE callback.
Other templates retain `{{ .ConfirmationURL }}` and `{{ .Token }}`; Supabase
substitutes and escapes template variables. Notification HTML escapes dynamic
titles and retains a plain-text alternative. No tracking pixels are included.

Invitations include three role-specific feature bullets before the acceptance
button. The People invitation action supplies `invitation_role`, `invited_by`,
and `workspace_name` as email personalization metadata. Supabase's template
conditions select administrator, technician, or employee copy; missing or unknown
roles use the employee overview, and missing inviter/workspace details use generic
wording. This metadata never grants access; organization memberships remain the
authorization source. To release this change, deploy the action and update the
hosted **Invite user** template from `supabase/templates/invite-user.html`.

## Validation

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` validate application changes. `supabase/tests/notification-regression.sql` is a transactional database regression suite that rolls all fixtures back. It covers routing, confidentiality, RLS/MFA, read behavior, coalescing, lease exclusion, acknowledgement, chat deduplication, and SLA deduplication.

### Provider documentation


- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

