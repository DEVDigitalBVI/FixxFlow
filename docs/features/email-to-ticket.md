# Email to ticket

Members email their workspace address, `<workspace-slug>@<INBOUND_EMAIL_DOMAIN>`, to create
tickets or reply to them. Administrators see the address and the last 50 inbound messages,
including rejections, at **Settings → Support workflows → Email to ticket**.

## Rules

- Only active members of that workspace with a confirmed account email are accepted.
- The receiving server's **DMARC** result must be `pass`. Results come from Resend's Receiving
  API (`authentication.dmarc`) and cannot be set by the sender, so forged From addresses are
  rejected. Messages without results are treated as unauthenticated.
- Standard `In-Reply-To` and `References` IDs resolve inside the receiving workspace before the subject-number fallback. The sender must still be the requester or active IT staff. Ambiguous references to multiple tickets are rejected.
- Requesters add public replies; staff replies on another person’s ticket become internal notes. A header-linked reply remains on the original ticket even if it is closed; it does not automatically reopen it. A subject-only reply to a closed ticket retains the existing follow-up-ticket behavior.
- New messages create tickets for the sender. `Re:`/`Fwd:` prefixes, quoted history and recognized signature blocks are removed. HTML is converted to text, never rendered as supplied. Tracking images are never fetched. The provider request uses `html_format=cid` to avoid expanding signature images into large base64 HTML payloads.
- Provider email IDs and RFC Message-IDs are deduplicated transactionally, with workspace-level serialization protecting concurrent intake. New provider IDs for the same Message-ID do not create another ticket, reply, or file job.
- Allowed attachments are imported by `/api/cron/inbound-email` into the existing private `ticket-attachments` bucket, then shown through normal ticket download links. No permanent public storage URL is saved.
- Limits: 20 candidate files, 10 MB per file, 20 MB total per email. Supported formats are PNG, JPEG, WebP, PDF and UTF-8 TXT/LOG. MIME, extension, size and byte signatures are checked; HTML, SVG, executables, archives and Office attachments are skipped. This validation is not an antivirus scan.
- Substantive inline screenshots can be imported when their content ID is referenced before known quote/signature containers. Small inline images, logo/signature filenames, and images found only in those containers are skipped. Attach screenshots as files if their inline presentation cannot be identified reliably.
- Staff-note attachments are marked internal. Both attachment-row RLS and Storage read policies exclude them from employee access; client uploads cannot reserve the worker’s `inbound-` object paths.
- The worker refreshes attachment metadata/download URLs, accepts downloads only from Resend’s inbound CDN, refuses redirects, bounds streaming reads and uses request timeouts. It never follows arbitrary URLs embedded in email HTML.
- Each file uses a deterministic object path and durable receipt. Leases, incremental progress and bounded retries recover interrupted uploads without registering a file twice. Ten failed attempts mark the job failed for administrator review. Administrators can see processing/imported/skipped state in the intake log.

Notification emails retain the ticket number and workspace Reply-To address. When a public inbound message exists, outgoing notification headers reference that message so replies can keep their email thread even if a subject is edited.

The MIME decoding is performed by Resend’s receiving service; FixxFlow consumes its structured body, headers and attachment metadata. See [Retrieve Received Email](https://resend.com/docs/api-reference/emails/retrieve-received-email) and [Retrieve Received Attachment](https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment) for the provider contract.

## Security design

- `/api/inbound/email` verifies the Svix signature (`svix-id`, `svix-timestamp`,
  `svix-signature`) over the raw body with a 5-minute window before reading anything.
- All database work happens in `accept_inbound_email`, executable only by the service role.
- `guard_automation_note` still stops service-role code from posting as a member. The inbound
  function writes a one-transaction context row for the exact ticket and author it verified;
  only the function owner can write that table.

## Enabling it

1. In Resend, add the receiving domain `support.fixxflow.com`, enable Receiving and disable
   Sending. Publish its DKIM TXT verification record and the receiving MX record shown by
   Resend, for that subdomain only. Wait until both show Verified. The Zoho inbox at
   `support@fixxflow.app` is unaffected.
2. In Resend → Webhooks, add `https://fixxflow.com/api/inbound/email` with the
   `email.received` event, then copy its signing secret.
3. In Vercel (Production), set `RESEND_INBOUND_WEBHOOK_SECRET` (the `whsec_…` secret) and
   `INBOUND_EMAIL_DOMAIN=support.fixxflow.com`. `RESEND_API_KEY` must have Full access:
   a Sending access key cannot retrieve incoming messages and results in webhook errors.
4. Confirm the Vercel cron `/api/cron/inbound-email` is deployed and protected by `CRON_SECRET`.
5. Redeploy, then send a test email from a member's address and check **Email to ticket**.

Until all three settings are present the endpoint returns 503 and the Settings page says the
feature is not switched on.

The primary application origin is `https://fixxflow.com`. The old `in.fixxflow.app`
receiving address is retired; it is not an inbound alias.

## Verification

Regression coverage includes header matching without a ticket-number subject, provider/RFC duplicates, forged references, closed-thread continuity, message/signature cleanup, invalid file bytes, bounded streaming, retry after uncertain registration, employee/staff attachment privacy, and service-only worker RPCs. Tests use synthetic mail and mocked provider/storage responses plus disposable PostgreSQL. Live SMTP delivery and the provider’s deployed webhook/cron configuration require a separate end-to-end check; do not treat unit tests as proof that external DNS and webhook settings are enabled.
