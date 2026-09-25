# Notifications

In-app notifications cover ticket assignment/reassignment, public responses, requester replies, new chats, chat responses, resolution/reopening, and approaching response/resolution SLAs. Internal notes and a person's own actions are silent. Active staff receive unassigned conversations. Recipient access is checked through RLS, including enrolled MFA assurance.

SLA warnings run every minute through Supabase pg_cron, independently of email. The warning starts in the final 20% of the target, capped at 30 minutes, and is deduplicated per recipient/objective/deadline. Time remains calendar-based.

## Enable Resend later

1. Verify your sending domain in Resend.
2. Add server environment variables in Vercel Production: `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL` (e.g. `FixxFlow <notifications@your-verified-domain.com>`), and a randomly generated `CRON_SECRET` of at least 32 characters. Keep these out of client code and source control.
3. Ensure `NEXT_PUBLIC_SITE_URL` is your HTTPS application URL and `SUPABASE_SECRET_KEY` is configured.
4. Redeploy. The Vercel cron invokes `/api/cron/notifications` every minute using its automatic Bearer authorization. This schedule requires a Vercel plan supporting per-minute cron.
5. Verify delivery with an explicitly authorized test recipient before relying on production email.

Until these settings exist, the email endpoint fails closed; in-app alerts continue working. No real email has been sent during automated testing.

Emails use verified Supabase Auth addresses and include generic event text plus an authenticated application link, never conversation bodies. Read alerts and unauthorized/inactive/unverified recipients are skipped. Reply bursts share an email within a five-minute bucket; all events remain in the inbox. Delivery waits at least one minute, processes five emails per cron, uses stable Resend idempotency keys and five-minute leases, and retries up to six times. Events older than 24 hours expire; retries stop before Resend's 24-hour idempotency window. Notification preferences are deferred.

The private `notification_email_outbox` table records pending/sending/sent/skipped/failed state and sanitized failures. Failed mail never blocks ticket transactions. Monitor this table and Vercel cron failures when enabling email. Queue throughput and retention should be revisited as usage grows.

## Validation

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` validate application changes. `supabase/tests/notification-regression.sql` is a transactional database regression suite that rolls all fixtures back. It covers routing, confidentiality, RLS/MFA, read behavior, coalescing, lease exclusion, acknowledgement, chat deduplication, and SLA deduplication.
