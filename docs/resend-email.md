# Resend email delivery

Automated notifications use the Resend API. Supabase Auth uses Resend SMTP for
account emails. The support inbox remains in Zoho Mail at `support@fixxflow.app`.
Notification replies go to that inbox; receiving a reply does not automatically
append it to a ticket.

## Production cutover

1. Confirm `fixxflow.app` is verified in Resend. Keep open and click tracking off
   in the Resend domain configuration. These are provider settings, not send-API
   fields. Preserve Zoho Mail's root MX records. Resend's sending/return-path DNS
   records can coexist with the Zoho mailbox; do not enable inbound receiving or
   replace the mailbox MX records for this migration.
2. In Vercel Production, configure server-only `RESEND_API_KEY` with sending
   access to the verified domain. Keep
   `NOTIFICATIONS_FROM_EMAIL=FixxFlow <notifications@fixxflow.app>`, the existing
   `CRON_SECRET`, `SUPABASE_SECRET_KEY`, and HTTPS `NEXT_PUBLIC_SITE_URL`.
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

## References and checks

### October 11, 2026 production verification

- Resend application migration `ee54dfd` deployed successfully through Vercel.
- Hosted Auth SMTP settings persisted after reload: `smtp.resend.com`, port
  `465`, username `resend`, sender `noreply@fixxflow.app` / `FixxFlow`.
- Vercel confirmed deletion of the obsolete sending variable. Local environment
  files, application source, tests, scripts, and Supabase configuration contain
  no legacy sending keys or legacy provider endpoints.
- The user authorized one password-reset test and one clearly labeled notification
  test to `jhodge@peterisland.net`. Resend reports both **Delivered**, and the
  user confirmed that both arrived in the recipient inbox.
- The scheduled dispatcher accepted the notification on its first attempt at
  `2026-10-11 16:23:47Z`, without a recorded error. Notification ID:
  `7979f0ba-e7ce-4ca7-8ed8-1f45209a04f3`; Resend email ID:
  `01a12bc7-0d5b-75ad-b9ba-27fb4386a59c`.
- The prior provider investigation is retained under `docs/archive/` as historical
  evidence. It is not current sending configuration. The obsolete setup guide
  was removed, and its provider-independent template instructions were moved here.

### Provider documentation

- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
Automated sender tests mock the network and send no real email.
