# Notifications

In-app notifications cover ticket assignment/reassignment, public responses, requester replies, new chats, chat responses, resolution/reopening, and approaching response/resolution SLAs. Internal notes and a person's own actions are silent. Active staff receive unassigned conversations. Recipient access is checked through RLS, including enrolled MFA assurance.

SLA warnings run every minute through Supabase pg_cron, independently of email. The warning starts in the final 20% of the target, capped at 30 minutes, and is deduplicated per recipient/objective/deadline. Time remains calendar-based.

## Configure Resend email delivery

1. Verify your sending domain in Resend. See [Resend email delivery](docs/resend-email.md) for the API sender, separate Supabase Auth SMTP setup, and cutover checks. The support inbox stays in Zoho Mail.
2. Add server environment variables in Vercel Production: `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL` (e.g. `FixxFlow <notifications@your-verified-domain.com>`), and a randomly generated `CRON_SECRET` of at least 32 characters. Keep these out of client code and source control. Use a Resend key with sending access to the verified domain.
3. Ensure `NEXT_PUBLIC_SITE_URL` is your HTTPS application URL and `SUPABASE_SECRET_KEY` is configured.
4. Redeploy. The Vercel cron invokes `/api/cron/notifications` every minute using its automatic Bearer authorization. This schedule requires a Vercel plan supporting per-minute cron.
5. Verify delivery with an explicitly authorized test recipient before relying on production email.

The administration status screen and email endpoint share the same configuration check: all five settings are required, the application URL must use HTTPS without embedded credentials, and the sender must be valid. Incomplete or invalid configuration returns 503 before the endpoint claims queued mail; missing or incorrect cron authorization returns 401. In-app alerts continue working. “Configured” confirms settings, not provider health or successful delivery. Automated tests use mocks and do not send real email.

Emails use verified Supabase Auth addresses and include generic event text plus an authenticated application link, never conversation bodies. Read alerts and unauthorized/inactive/unverified recipients are skipped. Reply bursts share an email within a five-minute bucket; all events remain in the inbox. Delivery waits at least one minute, processes five emails per cron, uses five-minute queue leases, and retries up to six times. Events older than 24 hours expire. Notification preferences are deferred.

Resend receives a stable `Idempotency-Key` per notification across queue leases. Within its 24-hour retention window, retries of the same payload reuse the provider result after an ambiguous failure. Changed payloads can produce a 409 and require investigation. Queue leases and provider idempotency do not guarantee permanent exactly-once delivery or deduplication across providers. Outbox `sent` means provider acceptance, not recipient delivery; bounce reconciliation is not implemented.

The private `notification_email_outbox` table records pending/sending/sent/skipped/failed state and sanitized failures. Failed mail never blocks ticket transactions. Monitor this table and Vercel cron failures when enabling email. Queue throughput and retention should be revisited as usage grows.

## Validation

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` validate application changes. `supabase/tests/notification-regression.sql` is a transactional database regression suite that rolls all fixtures back. It covers routing, confidentiality, RLS/MFA, read behavior, coalescing, lease exclusion, acknowledgement, chat deduplication, and SLA deduplication.
