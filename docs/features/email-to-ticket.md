# Email to ticket

Members email their workspace address, `<workspace-slug>@<INBOUND_EMAIL_DOMAIN>`, to create
tickets or reply to them. Administrators see the address and the last 50 inbound messages,
including rejections, at **Settings → Support workflows → Email to ticket**.

## Rules

- Only active members of that workspace with a confirmed account email are accepted.
- The receiving server's **DMARC** result must be `pass`. Results come from Resend's Receiving
  API (`authentication.dmarc`) and cannot be set by the sender, so forged From addresses are
  rejected. Messages without results are treated as unauthenticated.
- A subject containing `[#1042]` adds to ticket #1042 when the sender is its requester (public
  reply) or IT staff (internal note, so an email reply never exposes text by accident). Other
  senders are rejected. Replies to closed tickets create a "Follow-up to #1042" ticket.
- Any other message creates a ticket for the sender. `Re:`/`Fwd:` prefixes are removed from the
  title, and quoted history is removed from the body.
- Attachments are not imported; the ticket notes how many there were.
- Ticket numbers are always resolved inside the receiving workspace.
- Processing is idempotent on Resend's email id, so repeated webhook deliveries are safe.

Notification emails about tickets include `[#n]` in the subject. When email to ticket is on,
their Reply-To is the workspace address and the email says replies are added to the ticket.

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
4. Redeploy, then send a test email from a member's address and check **Email to ticket**.

Until all three settings are present the endpoint returns 503 and the Settings page says the
feature is not switched on.

The primary application origin is `https://fixxflow.com`. The old `in.fixxflow.app`
receiving address is retired; it is not an inbound alias.
