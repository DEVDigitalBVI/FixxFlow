# Assets and inventory enhancements

## Asset imports

Asset imports default to creating new records. Staff can explicitly choose **Create or update by asset tag** for CSV/Excel updates. The preview identifies Create versus Update, shows every imported field, and retains each matched asset's revision. Optional blank cells (including omitted columns) clear saved values in update mode; the review explains this before saving. Blank kind/status retain the documented computer/available defaults. Include every field you want to keep.

Save revalidates references and sends one atomic `import_asset_updates` RPC. It locks tags in stable order and checks original preview revisions before writing. A concurrent edit or newly created matching tag rejects the whole batch. IDs, assignment history, linked tickets and stock-bucket identity stay intact. Existing guards still block unauthorized changes to stored/reserved equipment. Uncertain responses require checking Assets and previewing again; updates are never silently replayed against a newer revision.

## Warranty and end of life

The existing optional purchase/warranty section also accepts an **End of life** date. Dates use calendar days in the workspace timezone. Neither warranty nor end of life may precede purchase. Assets retain their normal lifecycle; reaching a date never automatically retires equipment.

The protected equipment cron runs every 15 minutes and checks a rotating batch of 100 eligible assets. Active IT staff receive in-app notifications and queued email when a date falls within 30 days, and again when it is reached. Each recipient/date/milestone is notified once. The job catches up after downtime and ignores retired assets. Changing a date creates a new reminder identity; the email dispatcher cancels pending reminders for removed/replaced dates, retired assets or no-longer-authorized recipients. Actual delivery uses the existing email dispatcher. In-app notices link to the exact asset; email opens Assets with the tag/date in the subject.

## Employee equipment history

Each People card links to **Equipment**. Staff see current assignments and a paginated assignment ledger, including returned/reassigned equipment. Existing assignments are seeded with **Assigned before history began**, without inventing an assignment date. Later assignments and returns are captured automatically, including inventory issuance and imports. Employees cannot read the staff ledger or use it to access former assignees' equipment. Organization and MFA checks remain in force.

## Low-stock alerts

Inventory managers configure **Low-stock alerts** on each item. A blank threshold disables alerts; zero warns when available stock is exhausted. Available stock means physically stored minus reserved, so approvals can trigger an alert before handover. The inventory list and detail show a written **Low stock** badge when availability is at or below the threshold.

Active inventory managers receive an in-app notice and queued email once per low-stock episode. Further reductions do not repeat it. Recovery above the threshold rearms the alert, while disabling or changing the threshold explicitly starts a new configuration episode. Recovery/disable cancels pending email. The dispatcher rechecks current manager capability and the episode before delivery; losing that capability also removes access to historical stock notices. Application role alone never grants inventory management. Threshold changes are audited and reject a stale settings version.

## Release and validation

Apply `20261027214732_equipment_alert_kinds.sql` and then `20261027214734_assets_inventory_enhancements.sql` before deploying these application changes. They are local only while the combined feature build-out is in progress. The pending chat, knowledge and search migrations precede them.

Tests exercise real migrated PostgreSQL for atomic import rollback, preview conflicts, assignment history, organization/role isolation, reservations, alert deduplication/recovery, capability revocation, reminder milestones and outbox cancellation. Native local Supabase checks use rollback-only fixtures in `supabase/tests/database/equipment_enhancements.test.sql`. The UI reuses ActionForm, SubmitButton, AssetStatusBadge, responsive tables, native disclosures, date/number inputs and existing tokens; no new styling system or design exceptions.
