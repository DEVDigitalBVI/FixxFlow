# Saved replies

Saved replies are reusable answers shared by a workspace's IT staff. Technicians and
administrators insert them into ticket replies, internal notes, and live chat from the
**Saved replies** picker beside the composer. Inserting adds filled-in text to the current
draft at the cursor; nothing is sent until the staff member sends the message. Employees
never see the picker or the replies.

## Placeholders

| Placeholder | Filled with |
|---|---|
| `{{requester_first_name}}` | Requester's first name |
| `{{requester_name}}` | Requester's full name |
| `{{ticket_number}}` | Ticket number, such as `#1042` (tickets only) |
| `{{agent_first_name}}` | The inserting staff member's first name |
| `{{agent_name}}` | The inserting staff member's full name |

Unknown placeholders, and known ones without a value (for example `{{ticket_number}}` in a
chat), stay visible so staff notice and edit them before sending.

## Management and permissions

Manage replies at **Settings → Support workflows → Saved replies**
(`/app/administration/saved-replies`). Technicians reach the same page from the picker's
**Manage saved replies** link.

- Every technician and administrator in the workspace can use and create replies.
- The author or an administrator can edit or delete a reply. Edits use revision checks so a
  stale editor cannot overwrite newer work. Deleting asks for confirmation and does not affect
  messages already sent.
- Titles are unique per workspace, ignoring case. Titles are up to 120 characters; reply text
  up to 10,000.
- Row-level security enforces staff-only access, authorship, and tenant isolation in the
  database. Changes are recorded in the audit log with the title; reply text appears only as a
  change marker.
- The composer loads up to 200 replies, sorted by title. If they cannot load, the composer
  keeps working without the picker.
