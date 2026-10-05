# Zoho email delivery

The support mailbox lives in Zoho Mail. Automated email uses Zoho CPaaS
(formerly ZeptoMail), since Zoho Mail excludes automated transactional sending.

## Production configuration

- Vercel `ZOHO_CPAAS_API_KEY`: server-only sending token from the FixxFlow
  CPaaS agent. Both raw tokens and copied `Zoho-enczapikey` values are supported.
- Vercel `NOTIFICATIONS_FROM_EMAIL`: `FixxFlow <notifications@fixxflow.app>`.
- Keep `NEXT_PUBLIC_SITE_URL=https://www.fixxflow.app` and the existing
  `CRON_SECRET`. The notification job runs every minute.
- Supabase custom SMTP: `smtp.zeptomail.com`, port `465`, username
  `emailapikey`, the agent's SMTP password, sender `noreply@fixxflow.app`,
  sender name `FixxFlow`.
- This integration uses the US CPaaS endpoint `https://cpaas.zoho.com/v1.1/email`.

Credentials belong in provider secret settings, never in this repository.
Changing the mailbox password does not rotate these CPaaS credentials.

The notification dispatcher also requires `SUPABASE_SECRET_KEY` to access its
queue. Administration's email status uses the same validation as the dispatcher:
the five required settings must be present, the site URL must use HTTPS without
embedded credentials, and the sender must be valid. The status reports configuration
readiness, not a live provider health check. Invalid configuration prevents queue
claims and returns 503 to an authorized cron request.

## Delivery behavior

Notifications preserve the database queue, leases, and bounded retries. They
contain a sign-in-protected deep link, with replies directed to
`support@fixxflow.app`. Open and click tracking are disabled.

Zoho's `client_reference` is a correlation value, not a documented idempotency
guarantee. If Zoho accepts a message but its response or database acknowledgement
is lost, retrying can deliver a duplicate. Queue leases prevent overlapping
workers from normally sending the same notification concurrently.

## Cutover checks

Verify the CPaaS DKIM and bounce CNAME records, send a notification test and an
authentication test, confirm delivery in Zoho's logs, and confirm the production
cron returns 200. Remove the unused Resend secret only after successful cutover.
The support mailbox's MX records must continue to point to Zoho Mail.

As of setup on September 26, 2026, Zoho customer validation was submitted and
the account displayed a temporary 100-emails-per-day limit pending review.
Monitor the CPaaS account review and credit balance before increasing volume.

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
notifications. Keep `{{ .ConfirmationURL }}` and `{{ .Token }}` intact; Supabase
substitutes and escapes template variables. Notification HTML escapes dynamic
titles and retains a plain-text alternative. No tracking pixels are included.
