# Expected response times and resolution ratings

Both features belong to the employee portal. They reuse the fixed SLA policy, ticket status model and portal surfaces.

## Expected response times

- **Request form.** Under "How is this affecting work?", a native disclosure ("How quickly will IT respond?") lists each impact with its first-reply and resolution targets in support hours (7 AM–10 PM every day). Values come from `fixedSlaTargets`, which the SLA regression test keeps in step with `private.ticket_sla_deadline`.
- **Each request.** A "What to expect" card shows the first reply ("Expect a first reply by …" or "IT replied …") and resolution ("We aim to resolve this by …", paused while IT waits for the employee, or "Resolved …"). It uses the same `ticketSla` evaluation staff see, phrased as outcomes rather than SLA states. Times render in the viewer's timezone and refresh with the shared SLA clock.
- When a target passes, the text says so plainly and does not blame the employee. Every state is written in words; the icon and edge color are supplementary.

## Resolution ratings

- On a resolved or closed request, the requester sees "How did IT do?": a native radio group from 1 (Very dissatisfied) to 5 (Very satisfied) plus an optional comment of up to 1,000 characters. Each option shows its number and label.
- There is one rating per resolution cycle (`ticket_id`, `resolved_at`). Closing a resolved request keeps the cycle. Reopening and resolving again starts a new one. The requester can change the rating; an existing rating sits behind "Change your rating".
- Ratings are accepted for 30 days after resolution, then the card shows the existing rating only.
- `rate_ticket_resolution` is the only write path. It derives the actor from the session; requires the requester, an active membership and required MFA; validates the score and comment; and snapshots the assigned technician. Direct table writes are revoked. Retrying an identical submission is harmless. A changed score adds a `resolution_rated` activity entry (score and previous score; comments are not copied into history).
- RLS: requesters read their own ratings; active IT staff read every rating in their tenant. Other employees and tenants see nothing.
- Staff see "Requester rating" in the ticket's resolution step, for the current and earlier resolutions, with comments. Reports shows resolution satisfaction (see `reporting.md`).
- Not included yet: notifications for low scores, satisfaction in exports or custom reports, and per-technician breakdowns. The technician snapshot is stored to support the last one.

## Verification

- `src/features/tickets/resolution-ratings-database.test.mjs`: requester-only access, unresolved and expired requests, validation, revoked direct writes, update history, close/reopen cycles, RLS visibility and the staff-only summary.
- `src/features/tickets/expectations-and-ratings.test.mjs`: impact targets, every expectation state, rating validation and labels, the native radio group, the change disclosure and the closed window.
- Migration: `supabase/migrations/20261028100000_resolution_ratings.sql`.
