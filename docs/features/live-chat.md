# Live chat

Employees can leave a message at any time. Chat intake and open conversations show
support hours as **7 AM–10 PM every day**, evaluated in the workspace timezone.
Outside those hours, employees see “IT is offline. Leave a message and we’ll follow
up.” This describes scheduled coverage, not a promise of an immediate reply during
hours. Existing realtime presence remains separate; an IT person who is currently
in the conversation can still reply outside hours.

Technicians use the same saved replies and placeholders as tickets. Replies insert
into the draft and can be edited before sending; they are never sent automatically.

## Idle conversations

Only open conversations whose latest public activity came from IT can close
automatically. Unanswered employee messages stay open. The clock excludes time
outside the same daily support hours, using the workspace timezone.

After 20 support hours, the employee receives an in-app warning and a queued email.
The chat shows its exact reply deadline. Closure requires both 24 support hours
since the IT activity and at least four support hours since the warning. A delayed
worker therefore gives old conversations a fresh grace period instead of closing
them immediately.

A public message, edit or upload clears the warning. If the latest activity came
from the employee, the worker waits for IT again. Internal notes do not count as
public replies. Pending reminder emails are cancelled when activity resumes or the
chat closes; emails already in flight cannot be recalled.

Automatic closure preserves the entire conversation and adds a short summary of
the topic and last public IT update. Internal notes are excluded. Employees can
start a new chat from the summary. Linked tickets are not resolved or modified.
Closure uses the existing system audit trail and queued notifications. Existing
recipient permissions, verified-address checks, retries and idempotency apply.

## Operations

Apply these migrations before deploying the chat changes:

1. `20261027170235_chat_idle_notification_kinds.sql`
2. `20261027170236_chat_support_lifecycle.sql`

`/api/cron/chats` runs every five minutes, authenticated by the existing cron secret.
Its service-only RPC scans at most 100 eligible conversations per call, rotates
past unanswered conversations, and locks each conversation against concurrent
public activity. Ordinary members cannot invoke the worker or forge lifecycle
metadata. The endpoint returns only counts, with correlated safe failures.
