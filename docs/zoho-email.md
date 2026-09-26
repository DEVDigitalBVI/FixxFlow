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
