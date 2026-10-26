# Ticket organization

Staff-only tools on the ticket's review step and in the queue. Employees never see tags,
links, watchers or saved views, including on their own tickets.

## Tags

- Up to 10 per ticket; lowercase, single-spaced, up to 40 characters of letters, numbers,
  spaces, dots, dashes or underscores. The add field suggests the workspace's most-used tags.
- Shown under the ticket title and (up to three) in queue rows. The queue's **Filters and
  sort** includes a **Tag** filter, kept in page links and removable as a chip.
- Stored in `ticket_tags`, not on `tickets`, because requesters can read their own ticket
  rows. Changes are recorded in the administrator audit log (the ticket activity timeline is
  visible to requesters).

## Related and duplicate tickets

- **Link a related ticket** by number (`#1042`). Links are two-way and stored once per pair.
- **Close as a duplicate…** links the ticket to a main ticket and closes it in one step
  (`mark_ticket_duplicate`): staff, MFA and workspace are checked, the ticket revision guards
  against stale views, internal notes are added to both tickets, and an optional message is
  sent to the duplicate's requester as a public reply. The status change uses the normal path,
  so notifications and activity apply.
- Conversations never move between tickets, so requesters never see each other's messages.
  A ticket can be a duplicate of only one main ticket, and a duplicate cannot be a main ticket.
- The duplicate's header shows **Duplicate of #N**. Links are audited.

## Watchers

- IT staff choose **Watch ticket** to be notified of public replies and of resolve/reopen
  changes without being assigned. Staff watch for themselves; administrators can remove
  anyone's watch. Employees cannot watch tickets.
- Notifications come from `notify_ticket_watchers_reply` and `notify_ticket_watchers_status`,
  which call the shared `enqueue_notification` helper. Reply notifications reuse the reply's
  event key, so a watcher who is also the requester or assignee is notified once. Internal
  notes notify no one.

## Saved queue views

- **Saved views** in the queue toolbar saves the current filters under a name (up to 20 per
  person) and links back in one click. Views are private to their owner; even administrators
  cannot see others' views.
- Only known queue parameters are stored (`QUEUE_VIEW_KEYS` in
  `src/features/tickets/queue-views.ts`), re-derived on the server. Paging, the selected ticket
  and messages are never saved.
