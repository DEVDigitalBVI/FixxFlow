# Product usage analytics V1

This is a first-party aggregate usage stream for the FixxFlow software owner. It is separate from tenant reports, article insights and the administrative audit log. No external analytics SDK or destination is used.

## Consent and data minimization

Sharing is **off by default**. Each signed-in user can opt in or out under Profile → Help improve FixxFlow. RLS prevents users, including customer administrators, from changing another person's preference. The database checks consent for every event, including mutations. Preference read failures default to off.

The retained counters contain only UTC day, event name, role, feature area and count. They contain no user, organization, ticket, article or chat IDs; names, emails, IP addresses, user agents, URLs, search terms, message contents and arbitrary event properties are not collected in this store. Necessary object IDs are passed transiently to authorize views, then discarded.

An internal deduplication table stores SHA-256 keys for session/event/object combinations, without raw IDs. View and search keys expire after one day; login keys after 90 days. These are short-lived pseudonymous operational keys, so this system should be described as aggregate/de-identified analytics rather than guaranteed anonymity. No user-level journey or unique-user/tenant count is available. Counts represent the opted-in cohort only.

Counter rows older than 365 days and expired deduplication keys are cleaned up opportunistically during opted-in event writes. Inactive installations need owner-run maintenance to physically purge expired rows; no dedicated scheduled cleanup job is configured yet. Opting out stops future collection. Previously combined counts cannot be separated by user for deletion.

## Event definitions

| Event | Source and counting rule |
| --- | --- |
| login | Completed password sign-in, MFA verification, or non-recovery auth-code callback for an active opted-in member. Deduplicated per auth session within 90 days. Failed credentials, incomplete MFA and token refresh do not count. |
| ticket_created | Successfully inserted ticket; includes chat conversions. |
| ticket_viewed | Authorized, visible ticket page; once per session/ticket/UTC day. |
| ticket_updated | Meaningful persisted ticket change; excludes no-ops and response/SLA timestamp maintenance. Resolution/reopen also count as updates. |
| ticket_resolved | Active status transitions to resolved or closed. Resolved → closed does not count twice. |
| ticket_reopened | Resolved/closed transitions back to an active state. |
| chat_started | Successfully created support chat. |
| chat_message_sent | Persisted public chat message, including the first message. Internal notes excluded. |
| chat_converted_to_ticket | Conversion RPC creates and links a new ticket. Retries and links to existing tickets excluded. |
| search_performed | Visible, successful first page of nonempty ticket or knowledge search results, including zero results. No query words or result content. Refreshed/remounted result pages may count again; pagination is excluded. |
| knowledge_article_viewed | Authorized, visible article page; once per session/article/UTC day. Separate from customer-facing article view counts. |
| asset_viewed | Reserved only. No producer or accepted browser event until the asset inventory feature exists. Knowledge attachments are not mislabeled as assets. |

Database mutation counts commit or roll back with the business transaction. Collection exceptions are swallowed so an analytics failure cannot reject a ticket/chat write. Browser telemetry waits for page visibility and uses no analytics cookie or browser storage. Server analytics runs after responses with Next.js `after`. Counts are observational, may miss browser/network failures, and are not suitable for billing or audit evidence.

## Owner access

Customer roles cannot read the private tables or call the summary. From the owner's Supabase SQL editor or a trusted backend with the existing service-role credential:

```sql
select * from public.product_usage_summary(30);
```

The result contains `day`, `event`, `role`, `surface`, and `count`; the window is bounded to 1–366 days. Never expose the service credential in a browser. No software-owner role or customer-facing analytics page has been invented.

For maintenance through the owner SQL connection:

```sql
delete from private.product_usage_dedup where expires_at < now();
delete from private.product_usage_counts where day < (now() at time zone 'UTC')::date - 365;
```

## Verification

Unit/component tests exercise the event allowlist, visibility and duplicate handling, opt-out, non-blocking failures, completed-login instrumentation and preference ownership. `supabase/tests/product_analytics.sql` runs temporary fixtures and rolls them back: opt-in/out, view/login deduplication, status transitions, chat conversion vs linking, note exclusion, denied customer reads, preference spoofing, and a deliberate counter overflow proving ticket creation still succeeds. No real user's sharing preference is enabled by the test.

The existing enrolled-MFA access policy was also applied to the administrator audit stream, matching the protection used by the surrounding workspace tables.
