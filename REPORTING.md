# Operational reporting V1

The IT overview shows six metrics; `/app/reports` provides ten chart panels. Employees do not receive reporting navigation or route access. The database RPC independently requires active administrator or technician membership and runs as the caller under existing RLS. Anonymous execution is revoked.

## Definitions

- Today is midnight to now in `America/Tortola`. This is fixed for V1 and displayed on screen.
- Created: tickets created today.
- Resolved: distinct tickets with an active-to-resolved/closed activity transition today, including those subsequently reopened. Repeated resolutions count once per ticket per day. Historical imports without activity records are not included.
- Open: all tickets currently outside resolved/closed, including waiting and on hold.
- Overdue: open tickets with `sla_next_due_at <= now()`.
- Average response: calendar minutes from creation to first public staff response for replies recorded today. Internal notes do not satisfy this timestamp.
- Average resolution: calendar minutes from creation to latest resolution recorded today. Reopening clears that timestamp until resolved again; earlier resolution cycles are not used in timing averages.
- Trends cover 30 local calendar dates including today, zero-filled for counts and null for absent timing samples.
- SLA compliance measures completed response/resolution targets in the period. Pending targets and missing deadlines are excluded. Reopened resolution targets are excluded until completed again.
- Reopened tickets: distinct tickets per day whose activity moved from resolved/closed into an active status.
- Workload and backlog age are current snapshots, not reconstructed historical backlog. Age runs from original creation.
- Categories, requester departments and ticket locations use current attributes, not historical snapshots. Unset values have explicit labels.
- Long category/workload breakdowns show the ten largest groups plus an aggregated remainder. Charts include exact text values; trend charts include native expandable data tables. Data refreshes on page load.

## Validation

- Unit/component checks cover duration formatting, aggregation totals, denied employee route access, failures, chart labels and data tables.
- `supabase/tests/operational_reporting.sql` checks the real RPC with temporary ticket fixtures in a transaction that rolls back. It requires an empty test organization with an active administrator. It verifies resolution/reopen counts, response/resolution timing, open/overdue counts, 30-day padding and cross-organization denial.
- The migration was applied and verified against the connected project. Supabase security advisor returned no findings. Anonymous execute privilege is false; the function is security invoker.
- Populated layouts were checked in Safari using synthetic fixtures, including mobile charts and expandable tables. No chart library or new tokens were introduced.
