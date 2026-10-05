# Automation dry run service — Stage 6

Stage 6 evaluates a definition without executing it. It adds no builder, list,
execution-history UI, manual execution, replay, notification delivery or activation.
Processing remains OFF. The service does not inspect or change the processing gate.
Every successful result and handled error carries `sideEffectsPerformed: false`
and the exact notice **“No changes were made.”** Future UI should display this
notice prominently for matching, nonmatching and invalid test results.

## Files

Created:

- `src/features/automation/dry-run-model.ts`: request, read-context and result types.
- `src/features/automation/dry-run.ts`: pure projection of the existing planner.
- `src/features/automation/domains/tickets/dry-run-context.ts`: ticket context adapter.
- `src/features/automation/dry-run-repository.ts`: session-client read RPC adapter.
- `src/features/automation/dry-run-service.ts`: administrator service entry point.
- `src/features/automation/dry-run.test.mjs`: integration, authorization, read-only,
  dependency-boundary and planner/reference parity tests.
- `src/types/automation-dry-run-database.ts`: read RPC database contract.
- `supabase/migrations/20261001031036_automation_dry_run_reads.sql`.
- This document.

Modified: `src/types/database.ts`, composing the new RPC type with existing types,
and the lease-expiry fixtures in `src/features/automation/execution-database.test.mjs`
and `src/features/automation/worker.test.mjs`. The fixtures now use one stable
statement timestamp for fields constrained to equality, removing a millisecond
clock-boundary failure without weakening assertions. No Stage 1–5 contracts,
executors, mutation paths, worker implementation, controls or UI changed.

## Read architecture and authorization

`testAutomation(input)` follows the existing server-only administrator service
pattern. `requireViewer()` supplies the organization, active role and existing MFA
flow. The caller cannot supply an organization override. Authentication/MFA
redirects propagate unchanged. Technicians, end users, inactive administrators and
implicit platform owners are denied before a database client is opened.

A migration is needed because retained domain events are private infrastructure.
The only new public API is `read_automation_dry_run`, a STABLE, security-invoker
wrapper around a private STABLE definer with an empty search path. It receives the
viewer-selected organization but independently requires `auth.uid()`,
`private.has_required_assurance()`, `private.has_organization_role(...)` and an
active administrator membership. A supplied tenant ID never grants authority.
Anonymous and service-role callers have no execute grant. Existing RLS and table
privileges are unchanged; no direct domain-event access is granted.

One statement reads the selected tenant ticket, optional event and exact immutable
rule version or unsaved definition, plus reference checks. An event must also
belong to the selected ticket. Foreign or unavailable ticket/event/rule identifiers
produce the same safe unavailable-source error. References outside the organization
fail validation without exposing foreign record details.

The repository exposes only `read`; its client never reaches the pure evaluator.
The module graph has no worker, executor, execution repository, notification
provider, publishing or privileged service-client dependency. There is no
`dryRun=true` executor mode. STABLE functions contain no writes or row-locking
operations, and the RPC is tested inside a READ ONLY transaction. Existing
session/authentication and database access are the only I/O boundaries; no external
notification/email/integration dependency is invoked.

## Definition and context behavior

Requests select a ticket and one definition source:

- `{ kind: 'draft', value: definition }`: validate with Stage 1 structured validation;
  malformed definitions fail before the read RPC. The database also validates its
  own direct callers with the existing structural validator. Nothing is persisted.
- `{ kind: 'version', ruleId, version }`: read precisely that immutable revision,
  including disabled or archived revisions. This tests its definition, independent
  of its saved enablement, activation/backlog, leases and chain admission. That
  distinction is explicit in warnings. It does not authorize execution or replay.

Context sources:

- `current_ticket`: hypothetical creation using current allowlisted ticket fields.
  Compatible creation definitions can be evaluated, but the result does not claim
  those values existed at actual creation. Transition triggers are incompatible
  until an appropriate retained event or explicit simulation is selected.
- `retained_event`: use the actual immutable before/after envelope. Conditions use
  its after snapshot; action references use current organization state. Report the
  event ID, evaluated revision, current revision and whether state differs. A
  materially different snapshot or revision blocks a proceed conclusion. Production
  stale-state enforcement remains unchanged.
- `simulated_transition`: current snapshot is the observed before state; explicitly
  supplied status/priority values form the simulated after state. Both use registered
  field validation. Report the simulated field names and warning; a no-op transition
  fails trigger compatibility. Assignment or other transitions require retained
  events in V1. No description, identity, reference or arbitrary field override is
  accepted in simulations.

Synthetic envelope IDs/timestamps are internal planner inputs only. They are never
persisted, returned as historical event evidence or supplied to execution authority.
Core validation, comparison and planning remain domain agnostic; only the ticket
adapter constructs ticket test contexts.

## Result semantics and safe data

The typed result contains structural validity/issues, planner status, trigger
compatibility/explanation, each AND leaf's field/label/operator/expected value,
safe actual value and passed/failed/error/not-evaluated status. It includes overall
condition outcome, ordered proposed actions, current-reference validity, safe
validation explanations, context/revision metadata, warnings and `wouldProceed`.

`wouldProceed` means the definition matches and all known current preflight checks
pass against a non-stale context. It is not a promise of runtime success. A real
execution can still fail due to later changes, leases, backlog eligibility, chain
limits or infrastructure. If a proposed action is invalid, later otherwise-valid
proposals are marked blocked, preserving stop-on-failure expectations. Nonmatching
or incompatible rules propose no actions.

Ticket subject actual values are redacted. Descriptions, conversations, provider
errors, credentials and full event envelopes are not included. Internal-note action
bodies are omitted from returned action configuration. Expected values supplied by
the administrator and allowlisted reference IDs remain available for explanation.
The future UI can resolve those IDs with its authorized picker data; this service
never reveals foreign reference labels.

Dry-run validation has its own `valid`/`invalid`/`blocked` vocabulary. It never
manufactures runtime `action_failed`, `delivery_failed` or `retry_exhausted`
outcomes, creates execution history or performs retries. Existing runtime failure
presentation and exhaustion distinctions remain unchanged.

## Current references

The read-only predicate mirrors the existing trusted reference adapter, with parity
tests, but does not take its mutation-time FOR SHARE locks. Technicians must be
active same-tenant workers; action teams/categories must be active. Condition
references may use inactive historical values, as in Stage 2, but must belong to
the organization. Exact category/subcategory equality pairs are checked for the
parent relationship. The existing category action accepts only categoryId;
subcategory mutation is not added.

Notification checks follow the existing requester/assigned-technician access and
active membership rules. Earlier proposed technician assignments determine the
proposed assigned recipient without updating a ticket. Missing/inactive/foreign
recipients fail preflight. No inbox or email-outbox insertion occurs. Checks are
point-in-time observations; the real command independently validates again.

The example “Notify IT Manager” is not an available V1 recipient selector. Stage 7
must retain the existing requester/assigned-technician options unless a separate
recipient-contract extension is approved. Likewise, status/priority simulation is
explicitly limited; retained events handle other historical transition tests.

## Verification and remaining gates

Final workspace results:

- Stage 6: **36 tests/subtests passed**, including planner parity for all ten
  supported operators, read-only database execution and reference parity.
- `npm test`: **487 passed, 0 failed, 0 skipped**. This includes Stage 1–5
  automation, security, routing, SLA, notification, employee reopening,
  conversation/history and audit regression suites.
- Clean replay of all migrations, including the new read functions: passed.
- `npm run typecheck`: passed.
- `npm run lint -- --max-warnings=0`: passed with zero warnings.
- Tracked and newly created file diff/whitespace checks: passed.

The existing Node module-type warning from older test imports remains; it is
separate from ESLint's zero-warning result.

Tests compare full row data (therefore counts too) before and after successful,
nonmatching, historical, simulated, invalid-reference and rejected-source tests:

- tickets (including revision, routing and SLA fields), messages and activity;
- notifications and the private notification email outbox;
- domain events and deliveries;
- executions, steps, chain counters/claims and command contexts;
- audit events, rules, immutable versions and processing controls.

The tests also reject external fetch calls and non-read RPCs, inspect the transitive
runtime dependency graph, and run the read API inside a READ ONLY transaction.
Planner parity covers all ten supported operators; reference parity covers the
seven registered resource kinds and active/historical lookup modes. Tests include
exact saved-version pinning, drafts, tenant and role denials, MFA, receipt-free
notification validation, history/current distinctions and simulated no-ops.

Pre-production gaps remain: Supabase PostgreSQL 17, actual PostgREST behavior,
independent concurrent sessions, declared Node 24 and Node 24 Unicode parity.
Available verification uses PGlite PostgreSQL 18.3 and Node 26.8.2. The local
Supabase advisor connection was attempted but refused at port 54322; no hosted
advisors or production migration/activation were performed.

Stage 7 should display “No changes were made.” prominently, label hypothetical and
simulated contexts, preserve stale-context warnings and distinguish known reference
failures from runtime failures. It will need authorized picker/label data and a
retained-event selector. No Stage 7 pages or components are included here.
