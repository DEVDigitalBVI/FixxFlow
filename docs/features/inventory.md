# Department inventory

Inventory is available at `/app/inventory`. Apply the additive `20261009024259_department_inventory.sql` migration before deploying the application. The migration creates no stock or permission grants, and does not reclassify, duplicate, or reassign existing assets. Existing tickets receive the `support` classification without activity or audit events.

Administrators grant **Manage inventory and fulfill requests** and **Request department inventory** in each person's Manage panel in People. These capabilities are independent of Employee, Technician, and Administrator roles. Administrators must explicitly grant themselves inventory management if they need it. Request permission accepts several departments, with several people per department. Deactivated memberships and revoked grants stop subsequent inventory commands. Requesters retain read access to their own historical requests.

## Stock and equipment

`inventory_items` is a stock bucket for one item type, allocated department, and physical storage location. Equipment and consumables share stock arithmetic, but only equipment has `inventory_equipment` rows referencing existing `assets`. Consumables never create individual assets. Allocation remains linked to the bucket after equipment is issued; employee assignment remains on the existing asset.

Managers set up a received item type, then record the stock physically received. Equipment must first exist in Assets, with an available lifecycle and no assigned employee. Receiving links these assets to the stock bucket and records their storage location. Receipt movements contain the receiving person, server timestamp, quantity, allocation, location, and optional reference/note. Equipment receipt forms support up to 100 assets at a time; equipment requests support up to 100 units so approval and handover confirmations remain manageable. Consumables use positive integer quantities without individual unit records.

Available quantity is `stock - reserved`. Stock is the quantity physically in storage. Approval increases reserved only. Issuance reduces stock and reserved by the full approved quantity. Every receipt, correction, reservation, release, and issue is recorded in the immutable `inventory_movements` ledger. Negative corrections require a reason and cannot reduce stock below reservations. Equipment corrections identify exact unreserved assets; removed equipment can be counted back into its original allocation through a new receipt/correction. Department transfers and returns after issuance are outside this version.

## Requests and ticket lifecycle

Requesters select an authorized department and item, enter a quantity, intended employee or destination, and optional reason. Consumables may reference an existing printer. Requester and recipient are separate identities. Requests preserve names, department, item, storage, destination, and printer context at submission; equipment records preserve asset tag, name, and serial context. Foreign keys retain historical references when people, departments, or assets are deactivated or renamed.

Submission atomically creates one ordinary ticket classified as `inventory`, its fulfillment record, and an optional printer link. It reserves nothing. The ticket queue has an Inventory requests filter; the inventory workspace lists request history. Conversations, attachments, activity, audit log, and notifications use existing infrastructure. Managers with the Employee application role can read linked inventory ticket conversations and files, while unrelated tickets and internal notes remain restricted.

Fulfillment states are independent of ticket status:

| Action | Fulfillment result | Stock effect |
| --- | --- | --- |
| Submit | Pending review | None |
| Ask for information | More information needed | Releases an existing reservation |
| Approve | Approved, reserved | Rechecks availability under lock; reserves exact equipment |
| Decline, with reason | Declined | Releases an existing reservation |
| Cancel | Cancelled | Releases an existing reservation |
| Mark as issued | Issued, fulfilled | Debits stored and reserved quantities once |
| Resolve or close ticket before issue | Cancelled | Releases an existing reservation |
| Reopen ticket | Unchanged | Never reserves or issues again |

Issuance confirms the approved recipient/destination and all reserved equipment. Equipment is marked in use and assigned to the recipient; departmental destinations remain recorded in the fulfillment history. Equipment stays in Assets with its original service history and ticket links. Consumable issuance stays in the usage ledger. Issued, declined, and cancelled fulfillment is final; another supply request needs a new ticket. Issuance leaves ordinary ticket status available for normal conversation handling and closure. Managers can ask questions and approve again after information arrives, using the existing public conversation. Closing or reopening an issued request does not debit stock again.

## Authorization and transactions

Browser and server actions use the authenticated Supabase client, never a service key. RLS restricts reads to the current organization and the applicable capability, department, requester, or existing ticket worker scope. Inventory tables have no authenticated direct write grants. The public command is a security-invoker wrapper around a private, explicitly granted security-definer function with an empty search path, live membership/MFA checks, and per-command authorization. Lookup RPCs expose bounded, literal-search pages of organization references after capability checks.

`inventory_command` requires a UUID retry token. Tokens are unique by organization and actor, and retain the original command/input/result. Same-token retries return the original result; changed input under the same token fails. Permission checks run before retry lookup. Failed commands roll back stock, ticket, movements, audit, notifications, and the token together. Approval and issuance are also safe when retried with a new token after the state has advanced.

Approval, issuance, cancellation, and ticket closure lock in ticket → request → stock order. Asset locks use sorted IDs. The stock row serializes competing requests; equipment state updates require the exact bucket and stored/reserved state. Stored and reserved assets cannot have lifecycle, location, or assignment changed through the existing asset editor/import. Issued assets retain their normal lifecycle. Database constraints prevent negative quantities, negative stock, and reserved stock exceeding stored stock.

## Validation

- `npm test`: database authorization and fulfillment scenarios, server-action validation, semantic form/table checks, and existing regression suites.
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:build`.
- `tests/helpers/inventory-concurrency.mjs`: native multi-session contention test. Set `FIXXFLOW_INVENTORY_TEST_PORT` to an explicitly disposable **localhost** PostgreSQL server, with the `postgres` npm client available. Optionally set `FIXXFLOW_INVENTORY_PG_CLIENT` to its local `src/index.js`. The test creates and drops its own database, replays all migrations, and checks competing consumable and specific-equipment approvals, simultaneous issuance, submission retries, and cancellation versus closure. `FIXXFLOW_INVENTORY_ADVISORS=1` also runs Supabase advisors there. Never point this workflow at a shared server.
- `node tests/helpers/inventory-ui-preview.mjs`: isolated browser fixture at localhost:4182, with simulated references and saves. `/compact` embeds a 375px viewport; `?width=768` or `?width=1024` checks tablet widths, and `/preview-light` checks the light theme. It checks native labels, keyboard focus, confirmation controls, failure recovery, and responsive cards without real user data.

The implementation reuses PageHeader, PageLoading, ActionForm, SubmitButton, LookupSelect, AssetStatusBadge, responsive tables, disclosures, and existing semantic tokens. New domain components provide stock/request forms, inventory tables and the ticket fulfillment panel. No design-system exceptions or new UI dependencies were introduced.

This version excludes procurement, incoming orders, supplier management, shopping carts, partial fulfillment, silent substitutions, allocation transfers, and post-issuance return workflows. Notifications use the existing in-app/outbox pipeline; actual email delivery still depends on the existing dispatcher configuration.

### Implementation verification (October 2026)

`npm test` passed all 788 tests; lint, TypeScript checking, the production build and the production proxy build check also passed. The migration was first replayed successfully in disposable test databases (PGlite and native PostgreSQL 18.4). It was subsequently applied to the hosted application Supabase database on October 9, 2026 UTC, to repair a workspace-loading failure after the inventory code was deployed without its schema. Its filename now matches the migration version recorded by Supabase. The existing signed-in session was reloaded in Safari and the hosted support overview loaded successfully. No stock or capability grants were created. Native multi-session tests passed all five contention/retry scenarios. Supabase advisors reported no newly introduced warnings; the existing pair of ticket UPDATE policies still produces a performance warning.

Browser checks used the isolated fixture, not a signed-in production session: desktop and 375px/768px layouts, light/dark surfaces, 200% page zoom, keyboard focus, and simulated failure → retained draft → successful retry. The new inventory layouts add no animation and inherit the shared reduced-motion rules. Real hosted authentication, realtime delivery and outgoing email were not exercised.

Visual direction follows the product owner's refined SaaS preference: existing asset table panels, quiet surface shifts, strong item typography, compact department filters, grouped stock arithmetic and native progressive disclosure. Employee request screens omit receiving, corrections and approval controls.
