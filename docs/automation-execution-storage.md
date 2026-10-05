# Automation execution storage and trusted ticket commands — Stage 4

Stage 4 introduces database authority and atomic ticket commands. It installs no
worker, cron, notification action, dry run, administration UI, or historical
replay. Processing is **off** after migration. Stage 1 models and Stage 2 rule
management APIs are unchanged. Stage 3 capture and delivery APIs remain intact.

## Files and schema

Migrations:

- `20261001022623_automation_execution_authority.sql`: execution/step storage,
  processing state, chain claims, condition/trigger checks, admission RPC and RLS.
- `20261001023010_automation_ticket_commands.sql`: validated transaction authority,
  ticket command RPC, constrained note authorship and provenance triggers.

Public tables:

- `automation_executions`: organization, rule ID and exact immutable version FK,
  pinned rule name, event and delivery FKs, entity identity, correlation/cause/root/
  depth, processing generation, expected entity revision, start/completion/duration,
  status, condition results, attempted-action count and allowlisted error code.
  `(organization_id,event_id,rule_id)` is unique, independent of rule version.
- `automation_execution_steps`: organization/execution, exact configured action
  ID/type/position, stable UUID idempotency key, attempt count, status/timing,
  allowlisted result receipt and error code. Execution/action and execution/position
  are unique. Tenant keys are composite. Configurations and note bodies are not
  copied into execution history; the immutable version is authoritative.

Private tables:

- `automation_processing_state`: single operational activation gate, cutoff time
  and monotonically increasing activation generation.
- `automation_chains`: bounded execution/action counts per organization/correlation.
- `automation_chain_claims`: one claim per organization/correlation/rule/entity.
- `automation_command_contexts`: authority keyed by PostgreSQL transaction ID,
  referencing a persisted execution/step. Present only during an authorized command;
  successful completion deletes it, and transaction rollback removes it.
- `automation_version_visibility`: immutable private transaction markers for rule
  revisions. Existing revisions are backfilled at installation while processing is
  off; a trigger records new markers without changing the Stage 2 tables or APIs.

History, version, delivery, correlation, cause, root, note/execution and chain
indexes accompany the foreign keys and uniqueness constraints. Domain events gain
a tenant-composite FK for their reserved automation execution ID.
Private events also retain a capture transaction ID and visibility snapshot. These
infrastructure fields do not change the public domain event envelope.

`ticket_messages.author_id` becomes nullable only for the constrained automation
authorship variant. Added fields are `author_type`, `automation_execution_id`,
`automation_step_id`, and `automation_name`. Existing human rows default to member
authorship and retain their required human ID. One note per step is enforced.
Automation-authored notes cannot subsequently be updated or deleted, preserving
their provenance and the action receipt; a future retention workflow must account
for that deliberate restriction.

Other new files:

- `src/types/automation-execution-database.ts`: database row and RPC contracts;
  direct Insert/Update types are `never`.
- `src/features/automation/execution-records.ts`: maps persisted records into the
  unchanged Stage 1 models and maps safe error codes to fixed explanatory text.
- `src/features/automation/execution-database.test.mjs`: clean migration replay,
  behavioral/security/atomicity tests, schema signature and evaluator parity tests.
- `src/features/tickets/authorship.ts`: shared human/system/automation labels.

Modified files: `src/types/database.ts`, the ticket detail page, existing
`ConversationTimeline`, `HistoryBrowser`, and conversation tests. These small
presentation changes prevent automation notes from appearing to be human-authored.
They add no controls, styling, layout, administration screens, or mutations.

## Backlog eligibility

`private.set_automation_processing(boolean)` is an **owner-only operational**
function. It is not granted to service_role, authenticated, or anonymous callers.
A false-to-true transition records database wall-clock time and advances the
generation. It is never called by these migrations.

For a new execution, all of the following must hold:

1. The persisted delivery has a live automation-consumer lease matching the token.
2. The same-tenant rule is currently enabled, unarchived, and at the requested
   immutable version. Its trigger is compatible with the persisted event.
3. Processing is active.
4. `event.occurred_at > greatest(processing.activated_at, rule.enabled_at,
   immutable_version.created_at)`. Equality is ineligible. Claim/retry time never
   substitutes for occurrence time.
5. The chain has capacity and no existing claim for this rule/entity.
6. The revision's transaction and processing activation transaction were visible
   in the event's capture snapshot (or occurred earlier in that same transaction,
   still subject to the strict timestamp cutoff).

This deliberately discards eligibility for events before activation, before
enablement/re-enablement, and before the currently selected revision. Editing an
enabled rule does not retroactively apply the new definition to queued events.
An existing execution always returns its pinned version; it is never re-pinned.
Each subsequent command also checks processing generation and current rule state:
editing, disabling, archiving, or reactivating processing stops unfinished work.
No caller can supply a historical cutoff or request a replay.

Cutoffs use existing Stage 2 database timestamps, not client timestamps. Private
visibility markers additionally reject an event created while enablement or
activation was uncommitted, even if timestamp ordering alone would accept it.
The implementation uses PostgreSQL's top-level transaction IDs and snapshot
visibility functions, documented for [PostgreSQL 17](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-SNAPSHOT).
Tests cover synthetic in-progress snapshots and successive committed transactions;
they do **not** resolve the real concurrent-session verification gap.

## Admission and command authorization

Service-only public RPCs delegate to private definer functions with an empty
search path. Both check the actual database role, not a caller-provided JWT role.

- `begin_automation_execution(delivery_id, token, rule_id, rule_version)` derives
  tenant/entity/event context from the locked delivery. It pins the immutable
  version, independently checks trigger compatibility, evaluates its flat AND
  conditions against the persisted event snapshot, claims the chain, and creates
  ordered steps. Nonmatching/invalid-context conditions produce `skipped` history
  and `not_attempted` steps, with no mutation authority.
- `execute_automation_ticket_step(execution_id, token, command)` accepts an assertion
  `{organizationId,entityId,action}`. The complete action must exactly equal the
  configured action in the pinned version, including ID, type, position and
  configuration. These caller fields never confer authority.

The command independently validates delivery ownership/event/consumer/token/expiry,
execution organization, pinned version, event/entity/type/correlation/trigger,
step identity, execution/step state, and predecessor completion. It locks the
ticket in the derived tenant, checks revision, and reuses Stage 2's locked current
reference adapter for technician/team/category validation. Lease expiry is checked
after blocking locks and before successful receipt storage. There is no arbitrary
field mutation or executable JavaScript/SQL in definitions.

Only then does it insert the private transaction authority record. The employee
update guard explicitly recognizes this validated system path. It does not depend
on `can_work_tickets()` returning NULL. Normal authenticated employee restrictions
remain the same. Definer rights on this trigger allow private authority inspection;
the trigger itself does not grant table writes or bypass the caller's RLS.

GUCs carry the existing Stage 3 delivery/causation identifiers only within this
command. They cannot fabricate the private authority row. A service JWT subject
is temporarily cleared for existing history/notification triggers and restored
before returning; automation cannot impersonate that human or suppress their
assignment notification as if they performed the mutation.

## Conditions and domain boundaries

Stage 1 TypeScript validation/evaluation/planning is unchanged. Database admission
adds a pure structured comparator and condition result builder using the existing
trusted catalog. Snapshot nullability and trigger predicates are adapter checks;
the generic tables, claims, comparison and condition result model have no ticket
columns. The dispatcher currently registers only the ticket adapter.

NULL never matches a value comparison, including negative operators. Missing or
invalid snapshot values fail closed. Conditions store outcomes/identifiers, not
their potentially sensitive values. SQL parity tests cover all registered operators
and invalid contexts. Native PostgreSQL `lower()` differs from JavaScript for dotted
I and contextual sigma, so a trusted frozen Unicode lowercase mapping implements
the JavaScript behavior without depending on database collation. The mapping is
Unicode 17 (the available Node 26 runtime); the parity test checks both runtime
and stored mappings. **Run this gate under declared Node 24 before deployment and
regenerate the trusted mapping from that runtime if its Unicode data differs.**
This version-alignment verification remains part of the existing Node environment
gap; it must not be dismissed as a cosmetic test difference.

Future domains register their event predicate/snapshot nullability and trusted
command adapter through migrations. They reuse execution and delivery contracts.
Changing transport latency does not require changing definitions or history.

## Ticket semantics and stale state

All six Stage 4 actions require `ticket.revision = execution.expected_entity_revision`.
Admission initializes this from the event revision. Each successful action stores
the ticket's resulting revision for the next action. A human change before/between
actions fails the next action with `stale_entity` and stops the remainder. Even
apparently harmless no-op commands and internal notes use this conservative check.
Conditions remain evaluations of the frozen event snapshot, not later requester
profile changes. Current action targets are always revalidated independently.

| Action | Existing behavior preserved |
| --- | --- |
| assign_technician | Active same-tenant technician/administrator membership; normal assignment history and notifications. |
| assign_team | Active same-tenant team; explicit assignment sets existing routing mode to manual. |
| set_priority | Existing priority enum and authoritative SLA preparation/recalculation. |
| set_status | Existing status enum and existing resolution/closing/reopening timestamp preparation; no new transition graph. |
| set_category | Active same-tenant category. The Stage 1 action takes only `categoryId`; changing category clears the old subcategory, while an unchanged category preserves it. Existing composite classification FK remains authoritative. Category changes do not add rerouting behavior. |
| add_internal_note | Staff-only note with NULL human author and pinned automation name/execution/step. It does not satisfy first response or emit a public-reply notification. |

An intervening internal note alone does not change the existing ticket revision;
a public staff reply that sets first response does. No revision trigger or ticket
write path is replaced. Existing routing, SLA, activity, audit, notification and
outbox triggers execute in the same transaction. Stage 1 `send_notification` stays
registered for later work but fails closed with `unsupported_action` here.

## Atomicity, failure and provenance

The ticket mutation (or note insertion), all triggered effects, revision advancement
and successful step receipt live in one database subtransaction. If any part fails,
all of that action's effects roll back. The outer transaction records a fixed safe
failure code, never SQLERRM, SQL detail, note content or provider data.

Completed steps return their existing receipt without repeating side effects,
including after a delivery is reclaimed with a new valid token. Wrong/expired
tokens cannot mutate. A lost transaction rolls back both action and receipt; a
lost response after commit returns the receipt on retry. Each committed attempt is
final in V1: failed steps are not retried, and later steps become `not_attempted`
with zero attempts and no start time. Earlier successes remain visible; execution
status becomes `partially_completed` or `failed`. No configurable failure policy.

Automation events retain the existing envelope and receive `actorType=automation`,
NULL actor ID, execution ID, parent event ID and its correlation/root with depth+1.
Existing activity details gain `automationExecutionId`/`automationName`. Existing
audit records receive the safe `Automation: <pinned name>` actor label without note
bodies or a parallel audit log. Conversation/history uses that textual label and
the existing staff-only filters, escaping name/body content as before.

## Chain bounds and security policies

- Unique organization/event/rule admission, independent of revision.
- Unique execution/action ID and position; stable idempotency receipt.
- One organization/correlation/rule/entity claim, including nonmatches, prevents
  repeatedly re-evaluating the same rule/entity in a causal chain.
- Incoming depth must be below 8; a depth-8 child event can be stored but not admitted.
- At most 32 executions and 100 action attempts per organization/correlation.
- Locked chain rows serialize budget consumption; no retry orchestration is added.

All new tables enable RLS. Private runtime tables have no client/service policies
and no direct grants. Public execution tables grant authenticated SELECT only,
with `automation_execution_admin_read` / `automation_step_admin_read` and restrictive
`automation_execution_mfa` / `automation_step_mfa`. Existing active tenant-role and
assurance helpers remain authoritative. Technicians, end users, cross-tenant admins
and implicit platform-owner authority cannot read execution details. Service access
is via the two constrained RPCs, not direct table SELECT/INSERT/UPDATE/DELETE.

Automation provenance columns are excluded from human insert/update grants and
checked by constraints plus trusted triggers. Service note insertion must use the
validated automation path. Historical rule versions and audit protections remain
unchanged. Execution records and pinned versions have no cascade deletion policy.

## Verification and remaining gates

Final checks in this workspace:

- `npm test`: **419 passed, 0 failed, 0 skipped**, including 37 Stage 4 tests/
  subtests, 278 condition-result parity cases and the new conversation attribution
  assertion. Clean replay and upgrading pre-existing Stage 3 data both passed.
- Existing Stage 1/2/3, audit/security, routing/SLA/notification, employee reopening
  and conversation regressions passed.
- `npm run typecheck`: passed.
- `npm run lint -- --max-warnings=0`: passed with zero warnings.
- Tracked and newly created file whitespace/diff checks: passed.

Apply both migrations before deploying the changed conversation readers, which
select the new provenance fields. Leave processing off during rollout. Adding
capture metadata backfills the private event table; plan a migration lock window
appropriate to its size. No production migration or activation was performed here.

The Stage 4 suite replays every migration into a fresh PostgreSQL test database.
It tests six actions, tenant/MFA/role boundaries, persisted-context assertions,
cross-tenant/inactive references, classification constraints, stale/partial failure,
lease reclaim, idempotency, atomic receipt failures, note provenance, safe errors,
backlog/version cutoffs, chain bounds, condition parity and schema signatures.
Existing Stage 1–3, routing, SLA, notifications, employee reopening, conversation,
security and audit suites are retained and run unchanged except the added
conversation-authorship assertion.

The test substrate is PGlite PostgreSQL 18.3 with test-only Supabase platform
schemas. It is not Supabase PostgreSQL 17, PostgREST, or concurrent independent
sessions. Node available here is 26.8.2; the repository declares 24.x. These gaps
remain open. No hosted database migration was applied. UI verification consists
of existing rendering/visibility tests and type checking; no new browser/screen
reader/viewport inspection is claimed for the attribution-only text change.

Before Stage 5 activation: verify real PostgREST return shapes/permissions and
multi-session lease/chain/optimistic-lock races; run declared Node/PG versions and
the Unicode parity gate; add explicit worker terminalization of abandoned running
executions when a delivery exhausts retries. Stage 5 should use database admission
as authority, handle ineligible/chain-blocked events without replay, and acknowledge
only after all eligible rule work for the delivery is settled. It must not treat
the pure planner as authorization or retry failed V1 steps.

No existing model contract was redesigned. The only presentation scope is truthful
automation attribution in existing conversation/history components. Existing tokens,
native semantics, responsive layout and focus behavior are reused; no design-system
exception or new UI interaction was introduced.
