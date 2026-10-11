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
6. Only after successful cutover, retire unused Zoho CPaaS sending credentials.
   Retain Zoho Mail credentials and mailbox DNS. Existing failed/expired outbox
   messages are not automatically replayed by changing providers.

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

If rollback is required, restore the prior application version together with its
Zoho CPaaS environment settings and restore the previous hosted Auth SMTP
settings. Do not automatically resend already accepted messages through another
provider; cross-provider deduplication is not guaranteed.

## References and checks

- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
Automated sender tests mock the network and send no real email.
