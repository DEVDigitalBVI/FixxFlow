# Operational and custom reporting

The IT overview shows six metrics; `/app/reports` provides ten chart panels. Employees do not receive reporting navigation or route access. The database RPC independently requires active administrator or technician membership and runs as the caller under existing RLS. Anonymous execution is revoked.

## Custom reports

Support staff can start from five practical templates or configure the guided builder across four focused report types. Definitions are constrained data—not SQL—and contain:

- a report type: volume, turnaround, SLA, or current backlog;
- a date range of at most 366 inclusive calendar dates;
- one to three compatible measures;
- a day, week, or month interval;
- time or one business grouping: status, priority, category, subcategory, team, technician, requester department, or ticket location;
- optional status, priority, category, subcategory, team, technician, department, and location filters.

Activity uses the event or completion date in the organization timezone. Non-time groupings use each ticket's current classification and assignment. Backlog reports are current snapshots; their date range is retained in the definition but does not reconstruct historical backlog.

Technicians can create personal saved reports. Administrators can also create shared definitions visible to all support staff. Owners can update or delete their personal definitions; administrators can manage any definition they can see. Employees cannot read definitions, execute report RPCs, or access exports.

Custom exports support Excel, CSV, and PDF. They include the organization, report name, snapshot time, timezone, period, grouping, exact values, and completed-sample counts. Spreadsheet formula prefixes are neutralized in CSV; workbook labels remain typed strings.

## Scheduled delivery

Administrators can attach weekly or monthly delivery schedules to saved reports, using the organization timezone and Excel, CSV, or PDF attachments. A minute cron endpoint performs two durable steps:

1. due schedules create one immutable delivery item per recipient with a snapshot of the report definition;
2. workers lease a bounded batch, generate fresh report data, send a recipient-specific email, and acknowledge success or retry with exponential backoff.

Leases are fenced, attempts are capped at five, and provider idempotency keys are delivery-specific. Delivery history retains status, attempts, scheduled time, snapshot time, format, and recipient. Attachments are not stored. Report definitions and schedules are audited; definitions are summarized and recipient addresses are represented only as a count in the audit log.

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
- The migrations were applied and verified against the connected project. Custom-report tables have tenant-scoped RLS, worker RPCs are service-role only, and all new foreign keys have covering indexes. The advisor retains an intentional warning for the authenticated delivery-history `SECURITY DEFINER` RPC; it independently requires an active administrator in the report tenant and exposes no arbitrary query input.
- Populated layouts were checked in Safari using synthetic fixtures, including mobile charts and expandable tables. No chart library or new tokens were introduced.
- Custom-report unit checks cover definition validation, URL round-tripping, value formatting, accessible exact-data tables, export completeness, attachment delivery, and provider idempotency.
- The migrated database integration check covers role and tenant isolation, personal/shared visibility, report calculation, schedule validation, redacted audit records, durable enqueue/claim/finish behavior, and administrator-only delivery history.
