# Automation portability — Stage 11

Stage 12 adds [guardrails and capacity backpressure](automation-guardrails.md); its
limits, scheduling and capacity-state semantics extend this stage's contracts.


Stage 11 adds configuration import/export only. It does not change execution,
activation, tenant authority, built-in templates or database schema. Processing
remains OFF. No production access or deployment is part of this stage.

## Interchange boundary

`portable.ts` owns the public JSON format, independently of database rows and
internal definition identifiers. A package has exactly these top-level fields:
`format`, `version`, `exportedAt`, `references`, `rules`. Format is
`fixxflow-automation`; version is integer `1`. `rules` is an array for future
package evolution, but V1 accepts exactly one rule. Array order defines action
order. Internal condition/action identifiers and positions are regenerated.

Current V1 is supported. Missing, malformed, older unsupported and unknown future
versions are rejected. A future-version error explains that a newer FixxFlow
version is required. There are no older portable formats to migrate. Unknown
fields are rejected at every structured level, not silently discarded.

The rule contains name, optional description (`null` when absent), trigger,
flat AND conditions and ordered actions. Temporal configuration retains canonical
`durationMinutes` and SLA `objective`; no episode, deadline, cursor or occurrence
state is portable. Every supported capability uses the existing engine validator.
An unsupported trigger/action/field blocks import; nothing is omitted or reinterpreted.

## References and review

References contain only a package-local `ref-N` key, a typed kind and a display
label. Supported kinds: technician, team, category, subcategory, requester,
department and location. A value slot references its local key with
`{"reference":"ref-1"}`. Reference-valued lists contain these objects. Repeated
uses of the same source entity and kind share a reference. Source organization,
rule, membership and user identifiers are never included as identity fields.
Unavailable source records receive a generic label and still require mapping.

Reference keys, kinds and usage are checked; missing, wrong-kind, duplicate and
unused references fail validation. A UUID supplied instead of a portable
reference is rejected, even on same-organization imports.

The administrator explicitly selects destination choices using the existing
tenant/MFA-scoped choices endpoint. Mapping is shown ten references per page;
selections persist across pages. An optional **Find a suggested match** request
looks for one active NFKC-normalized, trimmed, case-insensitive exact display-name
match in a complete bounded search result. Ambiguous or truncated results produce
no suggestion. A suggestion is never a selection: **Confirm suggested match** is
required. Action targets must be active; inactive values can still be selected
for historical conditions, consistent with persistence semantics.

Pure mapping establishes structure, not database authority. The resulting draft
uses destination IDs and the ordinary builder, shared validator, dry run and
create service. Existing server/database checks revalidate current tenant
ownership, entity validity and action references on dry run/save. Revoking or
deactivating a destination after selection therefore cannot bypass persistence.
Preview-only synthetic IDs are used solely to reuse human summaries before
mapping; they are never passed to save or dry run by this workflow.

## Import and export UX

**Import Automation** on the list opens an administrator-only page. File selection
parses in memory; no attachment upload or permanent file storage occurs. Review
shows the shared human-readable summary and source labels, then destination
mapping. **Review and test draft** opens the existing WHEN → IF → THEN builder.
The administrator can change settings, **Test Automation** and **Save as disabled**.
Dry run retains **No changes were made.** Save feedback explicitly says the
automation was imported disabled. Import never enables rules or global processing.
Returning to mapping preserves selections; leaving an edited builder uses its
existing discard confirmation.

**Export** in rule controls downloads a sanitized `.fixxflow.json` filename through
a read-only session-authenticated route. It uses the current definition, not
runtime history, and does not create versions or audit writes. Download responses
are private/no-store JSON attachments with `nosniff`. Failed downloads preserve
the page and announce a safe retryable error. Archived rules can be exported from
their detail page. Exported text (including configured internal-note text) is
configuration and should be reviewed before sharing.

## Security and limits

- Import/export require the existing active tenant administrator and MFA path.
  Platform ownership alone grants nothing. No service-role client is introduced.
- Import is untrusted structured data. No JavaScript, SQL, HTML, shell or template
  execution is supported. Text resembling code in a note remains inert plain text;
  React escapes it in previews. Unknown code/expression properties are rejected.
- UTF-8 file size: at most 512 KiB, checked before reading where file size is known
  and again before parsing. A lexical nesting guard runs before `JSON.parse`.
- At most 12 object/array nesting levels; shared JSON guard also caps 10,000 nodes,
  100,000 aggregate key/string UTF-16 code units and arrays of 1,000 elements.
- One rule, 200 references, 50 conditions, 20 actions, 100 values per list.
  Existing limits remain authoritative: name 120, description 2,000, note 20,000
  characters. Portable source labels are capped at 180 characters.
- Prototype keys, non-JSON data, arbitrary metadata and runtime records are
  rejected. No execution history, events, deliveries, audit history, telemetry,
  leases or correlation chains are exported/imported.
- **Secrets are never an export capability.** Supported triggers, fields, actions
  and configuration keys are explicitly allowlisted. Future credential-backed
  actions must export only a mapping requirement for a destination credential,
  never credential material. Adding an engine action does not make it portable.
  There is no secret scanner: administrators must not paste credentials into
  ordinary names/descriptions/notes or reference display names, and must review
  this human-authored text before sharing any configuration file.

Successful imports use the existing `created` administrative audit event for the
new rule. V1 adds no import-provenance column or audit mutation. Failed parsing,
mapping, previews and exports create no audit noise. Historical versions and
execution history remain exclusively in their existing stores.

## Extension rules

New engine capabilities require a separate portability review: add an explicit
configuration projection/allowlist, reference kinds if necessary, positive and
adversarial tests, and documentation. Never spread an internal rule/database row
into the export. Incompatible interchange changes require a new schema version
and an explicit parser; unknown versions must continue failing closed. Multi-rule
packages, template packs and credential mapping are future work, not V1 shortcuts.
Built-in templates remain trusted application-defined drafts separate from imports.

## Sanitized example

```json
{
  "format": "fixxflow-automation",
  "version": 1,
  "exportedAt": "2026-10-01T12:00:00Z",
  "references": [
    { "key": "ref-1", "kind": "team", "sourceLabel": "Network Team" }
  ],
  "rules": [{
    "name": "Critical Ticket Routing",
    "description": "Route new critical requests for review.",
    "trigger": { "type": "ticket.created", "configuration": {} },
    "conditions": {
      "operator": "and",
      "items": [{ "field": "priority", "operator": "equals", "value": "critical" }]
    },
    "actions": [{
      "type": "assign_team",
      "configuration": { "teamId": { "reference": "ref-1" } }
    }]
  }]
}
```

## Verification and remaining gates

Tests cover bounded parsing, temporal round trips, all reference fields, explicit
mapping, suggestions, inert text, keyboard-native controls, error focus, disabled
save/dry-run reuse, administrator/MFA denial and tenant-scoped exports. The local
PostgreSQL suite sends mapped definitions through the real creation RPC and checks
disabled version 1, normal audit creation, cross-tenant/missing/inactive rejection.
Existing security and automation regressions remain required.

Full screen-reader audit remains pending, including file selection feedback,
mapping-page announcements, suggested-versus-confirmed state, errors and download
failures. Local responsive/browser checks do not replace authenticated hosted
PostgREST/MFA tests. Supabase PostgreSQL 17, representative hosted concurrency,
hosted tenant isolation and execution/activation/recovery/observability gates
remain deferred. No deployment or activation is authorized by this stage.

## Stage 11 change inventory

Created:

- `src/features/automation/portable.ts`: typed interchange, parser, bounds,
  projection, mapping, preview, suggestions and filenames.
- `src/features/automation/portable-service.ts`: authorized read-only export.
- `src/features/automation/import-automation.tsx`: file review and mapping flow.
- `src/features/automation/export-button.tsx`: download feedback and recovery.
- `src/app/app/administration/automations/import/page.tsx`: authorized import page.
- `src/app/app/administration/automations/[ruleId]/export/route.ts`: private download.
- `portable.test.mjs`, `portable-ui.test.mjs`, `portable-service.test.mjs` in the
  Automation feature directory: portability, UI and authorization coverage.
- This document, including the tested sanitized package above.

Modified:

- Automation list page: Import entry point.
- Automation detail page and builder: imported-draft review and disabled feedback.
- `rule-actions.tsx`: Export control, including archived detail access.
- `globals.css`: reuse existing layout with safe long-label wrapping/file width.
- `persistence.test.mjs`: real RPC verification of mapped draft creation/rejection.
- `ui.test.mjs`: list entry point and Export regression coverage.

No new library, icon family, design tokens, schema migration or runtime capability.
Shared header, cards, buttons, form controls, ReferencePicker, summaries, builder,
dry-run panel, focus styling and responsive breakpoints remain authoritative.

Local acceptance evidence: Node 24.21.0; 655 application tests pass, including
50 added tests and clean local database replay within the existing suites.
Typecheck, ESLint with zero warnings, production build and diff checks pass.
The existing Node module-type warning from uploads tests remains unrelated.

Browser visual verification at 1440/834/390px is **BLOCKED**: native Safari control
was repeatedly interrupted and there is no isolated browser connection available.
Generated local fixtures do not constitute completed visual checks. Component
tests verify native keyboard controls, review/error focus, associated mapping
errors, explicit suggestion confirmation and the normal builder/dry-run/save flow.
Full screen-reader and live responsive checks remain acceptance follow-ups.
No deliberate design-system exception was introduced.

The local processing environment flag is unset/OFF; all 39 migration files remain
unchanged. Production Supabase was not queried or modified; production settings
were not changed or rechecked. This work does not activate processing or start
another stage. The next stage should retain hosted authorization/visual/assistive-
technology verification as explicit gates, rather than treating local tests as
deployment evidence.
