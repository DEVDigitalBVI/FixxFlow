# Email and chat intake automations

Pending enhancement migration: `20261028012721_automation_intake_and_article_replies.sql`.

The rule builder has two additional creation events:

- **Ticket created from email**: a new ticket accepted from a verified active member by the inbound email handler. Email replies, internal notes, rejected messages and repeated provider deliveries do not trigger it.
- **Ticket created from chat**: staff convert a standalone chat into a new ticket. Linking an existing ticket, subsequent messages, and repeated conversion do not trigger it.

Both still emit the ordinary **Ticket created** event. Use channel-specific rules when behavior should apply only to that source; a generic creation rule applies to all sources. No historical source events are backfilled. Existing rules, processing switches, quotas, dry runs, retry receipts and history continue to apply. This migration does not enable processing or create/enable rules.

## Reply with suggested articles

This optional action is available only for the three ticket creation triggers. It looks for up to three published employee guides matching the ticket subject, using the knowledge base's weighted title/summary search. It searches the organization’s guides and the shared library, excludes hidden library guides, drafts, staff-only content and other organizations, and never searches private notes or request descriptions. Category alone is insufficient to send an automatic reply.

If useful guides are not available, no reply or notification is sent. The action also skips resolved/closed tickets, inactive requesters, tickets IT has already answered, and tickets that already received an automatic guide reply. Execution history explains a completed action that sent no reply. Existing revision protection may stop a delayed rule if a human response or other ticket change happened first.

An actual reply is a public ticket message attributed to **Article suggestions**, with named guide links in the conversation and normal ticket notifications. It does not count as an IT first response, change assignment, close the request, or expose the internal rule name. The requester can continue replying normally. Sending is deduplicated across rules and across the generic/channel creation events; a completed step is never replayed. Matching and message/notification receipts are in the existing transactional worker command.

Dry runs simulate the chosen channel and explain that article matching happens at execution time; they do not send a message or certify the ticket’s historical intake source. Rule export/import includes the new events and the empty-configuration action.

## Validation

`intake-database.test.mjs` exercises real migrated PostgreSQL and the existing durable worker for provenance, tenant isolation, visibility, cross-rule deduplication, notifications, human-response precedence and no-match behavior. `intake.test.mjs` covers contracts, dry runs, portable definitions and safe named links. `supabase/tests/database/automation_intake.test.sql` provides rollback-only native Supabase checks. Browser fixtures use real components and mocked server actions; no live employee messages are sent during validation.
