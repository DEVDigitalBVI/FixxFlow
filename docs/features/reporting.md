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

Administrators can attach daily, weekly or monthly delivery schedules to saved reports, using the organization timezone and Excel, CSV, or PDF attachments. A cron endpoint runs every 15 minutes (at :00, :15, :30 and :45, so on-the-hour schedules send on time) and performs two durable steps:

1. due schedules create one immutable delivery item per recipient with a snapshot of the report definition;
2. workers lease batches of three, generate fresh report data, send a recipient-specific email, and acknowledge success or retry with exponential backoff. A run keeps leasing batches for up to 40 seconds of its 60-second limit, so large recipient lists clear in one run; retries wait for their backoff and the next run.

Leases are fenced, attempts are capped at five, and provider idempotency keys are delivery-specific. Delivery history retains status, attempts, scheduled time, snapshot time, format, and recipient. Attachments are not stored. Report definitions and schedules are audited; definitions are summarized and recipient addresses are represented only as a count in the audit log.

## Definitions

- Today is midnight to now in the workspace timezone, displayed on screen.
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

## Daily delivery and dashboard insights

Saved reports now support **Daily**, Weekly and Monthly delivery. Only administrators can create schedules. Daily has no weekday/month-day field; irrelevant controls stay hidden and disabled, while Hour and the existing format/recipient choices remain available. New schedules use the workspace timezone. Each saved schedule displays its own timezone, including after an organization timezone change. Existing schedules keep their cadence and next-run timestamp.

Daily means every local calendar day, including weekends. A run at the exact scheduled instant advances to the next local day. PostgreSQL resolves a repeated fall-back hour to its standard-time occurrence and maps a missing spring-forward hour forward. The existing scheduler, delivery ledger, leases, recipient-specific provider keys, retry limits and delivery history are reused. Each delivery reruns the saved report definition; adding Daily does not change its selected date range or create a rolling period.

The staff dashboard keeps work queues before the new **Workload & response** section. Technician workload shows the five largest current queues, including unassigned work, with Open, Waiting and Overdue counts. Waiting/overdue are subsets of Open, not extra tickets. Open means every status except resolved/closed. Inactive or no-longer-IT assignees remain visible when they still own open work. Source membership, ticket and profile RLS apply, with active staff and MFA checks in `technician_workload`. Employee callers receive no workload rows; anonymous execution is revoked.

The response chart reuses the operational report's last 14 local reply dates and elapsed calendar minutes from creation to the first public IT reply. Internal notes do not establish first response. Null days stay as gaps; zero-minute samples remain valid. The shared Trend component retains exact daily data in a collapsed native disclosure. The operational report is request-memoized on the dashboard so metrics and the chart share one report query. Loading, empty and unavailable states remain distinct, with retry on failure. Counts refresh on page load.

Apply `20261028003353_daily_reports_and_workload.sql` before releasing the UI. It is applied locally only during the current build-out. Tests cover daily boundaries, weekends, daylight-saving transitions, database authorization/MFA, inactive assignees, current backlog totals, waiting/overdue subsets, durable daily enqueue/deduplication, action validation, native timing fields, nullable chart samples and failure recovery. The native local database check contains 12 rollback-only assertions.

## Resolution satisfaction

Reports shows **Resolution satisfaction** for the last 30 days, from employee resolution ratings (see `docs/features/resolution-ratings.md`): the share rated 4 or 5, the average score, ratings received, the count for each score, and the five latest written comments with links to their tickets. The period uses when each rating was first submitted. `satisfaction_summary` runs as the caller and requires active IT staff with required MFA; employees are denied. With no ratings, the panel says so instead of showing zero. Satisfaction is not yet included in report downloads or custom reports.
