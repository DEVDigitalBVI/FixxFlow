# Automation administration

## Automation administration — Stage 7

The Automation administration UI is implemented inside the existing Administration
experience. The subsequent [Stage 8 templates and UX polish](administration.md#templates)
extends this UI; production rollout/activation remains deferred. No migration, page or Server
Action enables the global processing switch. Deployment configuration is unchanged.

### Routes and files

Under `/app/administration/automations`:

- `/`: name search, enabled/disabled/archive and trigger filters, bounded list,
  run statistics and management actions.
- `/new`: template gallery or Start from scratch, followed by the disabled draft builder.
- `/[ruleId]`: existing rule builder, separate lifecycle controls and history link.
- `/[ruleId]/history`: paginated execution history.
- `/[ruleId]/history/[executionId]`: pinned-version execution detail.

The route directory also contains `layout.tsx`, `actions.ts`, `loading.tsx` and
`error.tsx`. `src/app/app/administration/page.tsx` and
`src/features/administration/sections.ts` add the Administration entry. No new
workspace navigation section is introduced.

New modules in `src/features/automation/`:

- `builder.tsx`: draft editing, validation, focus, save/conflict behavior.
- `reference-picker.tsx` and `value-control.tsx`: bounded searchable tenant pickers
  and context-sensitive native value controls.
- `dry-run-panel.tsx`: current/historical/simulated test sources and safe results.
- `rule-actions.tsx`: enable, disable, duplicate and archive forms.
- `page-parts.tsx`: shared page headers and pagination.
- `ui-model.ts`: human labels, condition/action summaries and immutable reorder.
- `ui-service.ts`: administrator-only read composition and label resolution.
- `ui.test.mjs`, `ui-database.test.mjs`, `builder-interactions.test.mjs`: verification.

Other changes:

- `src/types/automation-admin-database.ts` adds the read RPC contract, composed into
  the existing `src/types/database.ts` override.
- `supabase/migrations/20261001032617_automation_admin_reads.sql` adds bounded reads.
- `src/app/globals.css` adds scoped Automation layout rules using existing tokens.
- `tests/helpers/component-harness.mjs` exercises real component handlers/state.
- `tests/helpers/automation-ui-preview.mjs` serves isolated UI fixtures for later
  browser checks; all server actions are mocked and it has no database connection.
- This document.

### Existing patterns reused

The UI reuses `ActionForm`, `SubmitButton`, `LiveSearchForm`, existing Administration
links, native `details`/`summary` confirmation patterns, `pageNumber`, literal-fragment
search normalization, ticket status/priority mappings and date presentation.
Existing `settings-card`, `field`, `input`, `button`, `badge`, `table-region`,
`responsive-table`, alert, focus, spacing and reduced-motion styles remain the
visual foundation. No UI library, icon family, palette or design system was added.

WHEN, IF and THEN are vertical cards. The builder exposes flat AND only; field
selection determines operators and value controls through the established registry.
Empty/not-empty operators remove the value control. References use organization
pickers with search and pagination. Category/subcategory condition pickers retain
parent context. The category action remains category-only and explains that a
category change clears an existing subcategory.

Actions reveal only their registered controls. Notifications offer only Requester
and Assigned technician using the existing standard template. There are no tags,
SLA actions, integrations, arbitrary recipient targets, OR controls or node graph.

### Save, enable and conflicts

New saves use Stage 2 `createAutomation` and remain disabled. Existing saves pass
the loaded expected version to `updateAutomation`; successful saves update the
local version. Enable/disable, duplicate and archive use existing management
services. A duplicate is a disabled copy. Enable and archive require named,
explicit confirmation in the existing native disclosure/form pattern. Archive
retains history and immutable versions; archived rules cannot be edited or enabled.

Recoverable failures keep controls mounted through `ActionForm`. Local validation
appears beside the affected field/row, with a focused summary and ARIA references.
Stale saves never overwrite newer revisions: conflict feedback preserves the draft
and offers a saved-version link in a new tab for comparison. Drafts stay in memory,
not browser storage or URLs. Cancel and link navigation warn about unsaved changes;
the before-unload guard covers document departure.

Rule controls apply to the saved version, not unsaved builder edits. Saving an
already-enabled rule preserves its enabled state under the established backend
versioning rules. Neither operation changes global processing. The layout explains
the deployment OFF state; the list combines deployment and database gates to report
processing availability. There is no activation control in this UI.

### Minimal backend additions

One new `read_automation_admin` RPC supports three fixed, bounded read kinds:

- `list`: tenant rules with literal name search, lifecycle/trigger filters, latest
  execution and run count, plus the read-only database processing state.
- `choices`: tenant memberships/workers, teams, categories/subcategories,
  departments, locations and ticket labels. Search pages return at most 51 rows
  (50 plus a next-page sentinel); explicit selected-label requests allow up to 100.
- `events`: at most 51 retained event choices for a same-tenant selected ticket,
  returning only ID, type, timestamp and revision, never before/after snapshots.

The public STABLE invoker wrapper delegates to a private STABLE definer with an
empty search path. It independently checks authenticated identity, administrator
membership and the existing MFA helper. Service role, anonymous, technicians,
end users and cross-tenant selection are denied. Every query is tenant-scoped;
no direct event-table grant, RLS weakening or mutation capability is introduced.
Search reuses `private.search_patterns` and deterministic ordering. Selected
foreign references return no labels. SQL identifiers are fixed, not user supplied.

Existing administrator/MFA RLS protects execution and step history. The server read
service adds explicit tenant, rule, execution and immutable-version predicates.
History pages use 50-row pagination and at most 20 steps per execution; ticket and
reference labels are fetched in bounded groups. The production planner, execution
engine, event model, worker, retries, authority and dry-run contracts are unchanged.

### Dry run and history presentation

Test Automation opens a dedicated panel and sends the current unsaved definition
to the Stage 6 service. It never saves the draft or calls execution commands. Every
result prominently displays **“No changes were made.”** The result shows trigger
compatibility, all condition outcomes and safe actual values, proposed actions and
current reference validation, ticket number and evaluated/current revision.

Current-ticket creation is labeled hypothetical. Status/priority transitions are
explicitly labeled Simulated. Recorded events have a bounded selector; differing
current/historical state produces an informative warning. If the draft or selected
context changes after testing, the panel labels the displayed result as stale and
asks for another test. It never suggests that a simulation actually occurred.
Reference labels are resolved securely; internal identifiers and note bodies are
not rendered as condition/action descriptions. User text is React-escaped.

History distinguishes Completed, skipped/nonmatching, Action failed, partial
completion, Retry exhausted, delivery failure, stale tickets and other established
states. Detail reads the exact version referenced by the execution, not the latest
definition. Completed, failed, waiting and unexecuted actions are separately labeled.
Errors come only from existing safe presentation mappings; no raw provider/SQL
errors, credentials, sensitive snapshots or configuration JSON is rendered.
Reference names are current authorized labels; immutable IDs and configured values
come from the pinned version. Renaming a team can therefore change its display name
without changing the historical target identity.

### Responsive and accessibility behavior

Builder grids stack below 768px and use `minmax(0,1fr)` so controls can shrink without
horizontal page scrolling. Tables use the existing labeled, keyboard-focusable
scroll regions and compact responsive cards. New row headers wrap on compact
screens. Existing theme tokens support light/dark appearance.

Native labels, fieldsets/legends, headings, select/input semantics, visible focus
and 44px controls are retained. Move Up/Move Down uses native buttons; no drag
interaction is needed. After reordering, focus moves to the moved action's control,
and a polite live region announces its new position. Added/removed conditions and
actions restore focus to useful controls. Test results receive focus. No new motion
is introduced; shared reduced-motion rules apply.

Automated component tests exercise the real handlers and focus targets, including
add/remove, operator changes, reorder announcements, validation, conflict/draft
retention, disabled creation and unsaved simulated tests. Native button semantics
provide keyboard activation. This is **not** a claim of completed live-browser
keyboard, screen-reader, viewport or visual inspection.

The computer-use environment reported no available browser and a failed native
pipe. An isolated HTTP fixture started successfully but browser inspection could
not run; it was stopped afterward. For manual verification, run
`node tests/helpers/automation-ui-preview.mjs` and open `http://127.0.0.1:4179`.
The fixture never connects to the application database or activates processing.
Before rollout, check keyboard-only operation, desktop/tablet/mobile layouts,
200% zoom, screen-reader announcements and both themes in a real browser.

### Verification and Stage 8 gates

Final verification results:

- **25 Stage 7 tests/subtests passed** across read security, migration replay,
  rendering, management-service wiring and component interactions.
- `npm test`: **512 passed, 0 failed, 0 skipped**, including Stage 1–6 automation,
  administration, security, dry-run, execution, ticket and notification regressions.
- Clean replay of all migrations, including the new read RPC: passed.
- `npm run typecheck`: passed.
- `npm run lint -- --max-warnings=0`: passed with zero warnings.
- `npm run build`: passed; all five Automation routes are present.
- Tracked and new-file diff/whitespace checks: passed.

The existing Node module-type warning from older test imports remains separate
from ESLint's zero-warning result. No test was weakened or skipped for this work.

Existing pre-production gates remain unresolved: Supabase PostgreSQL 17, actual
PostgREST behavior, independent concurrent sessions, declared Node 24 and Node 24
Unicode parity. Local verification uses PGlite PostgreSQL 18.3 and Node 26.8.2.
Local Supabase advisors were attempted and failed to connect at port 54322. No
hosted advisors, production migration, rollout or activation was performed.

Stage 8 must also complete the browser checks above, apply the read migration before
deploying these routes, and review processing controls separately. No backend
architecture was redesigned and no design-system exception was introduced.

Stage 9 extends the WHEN card with elapsed-time and SLA threshold controls. See
[Temporal automation](temporal.md) for episode semantics, discovery,
read-only temporal tests and deployment restrictions.

Stage 10 adds organization-scoped Operations and global execution history inside
Automation administration. See [Operations and health](operations.md)
for precise health/lag semantics, tenant visibility, tests and deferred hosted gates.
This later record supersedes the older environment notes above for local Node 24
verification only; it does not close hosted verification gates.

<a id="templates"></a>

## Automation templates and UX polish — Stage 8

This stage adds presentation only. Production alignment/activation remains deferred;
there are no new migrations, engine semantics or processing controls. Earlier
rollout verification records remain separate from this newly approved UI stage.

### Built-in templates

`src/features/automation/templates.ts` defines a small typed, application-owned
catalog: stable ID, name, description, category, use case, guidance and a normal
`AutomationDefinition`. `templateDraft` clones a definition and explicitly returns
`enabled: false`; no template identifier is stored in a rule or passed to execution.

| Template | Starting condition | Action / required administrator input |
| --- | --- | --- |
| Urgent Ticket Assignment | Priority equals Urgent | Select team |
| Category Based Routing | Select category | Select team |
| Technician Assignment | Select category; editable | Select active technician |
| Priority Adjustment | Select category; editable | Select priority |
| Add Internal Triage Note | Select category; editable | Enter internal note |
| Requester Notification | Priority equals Urgent | Standard ticket update to Requester |

No candidate required new capabilities. References are blank, never guessed from
organization choices or replaced with synthetic IDs. Templates with missing inputs
are deliberately incomplete drafts: normal Stage 1 validation rejects them until
completed. Tests complete each blueprint with explicit fixture choices and require
it to pass the real validator. Invalid initial drafts must fail only for the known
unresolved inputs. The requester template needs no organization-specific reference.

The `/new` gallery offers Start from scratch and six native-button template cards.
Preview disclosures explain the starting rule and any routing/SLA/notification
considerations. Selection opens the existing builder; Save and Test use exactly the
same server actions, validators and read-only dry-run service as manual drafts.
Returning to the gallery warns before discarding edits and restores focus to the
chosen template. Draft content is never placed in URLs or browser storage.

### Adding a template safely

1. Confirm trigger, fields/operators and actions already exist in the registries.
2. Add a unique stable catalog ID and plain-language metadata. Use a flat AND group
   and contiguous action positions. Keep organization references empty and explain
   required setup; never embed real tenant data, arbitrary code or new semantics.
3. Verify completed drafts against `validateDefinition` with the persistence registry.
   Extend completion fixtures if a new kind of required input is used. Ensure blank
   references stay invalid, draft clones are independent and saving stays disabled.
4. Check gallery/preview labels, builder selection, summaries, dry run and keyboard
   behavior. Do not add template-specific execution or persistence code.

### Derived presentation

`summary.ts` derives a concise rule summary from the structured definition and
resolved tenant labels. It uses `ui-model.ts` trigger phrases, condition/operator
labels and action descriptions, sorting actions by their configured position.
Summaries update with builder changes and appear in template previews, builder
review and saved-rule enable confirmation. They are not authoritative or stored.
Internal-note bodies and raw reference IDs are not included; unavailable references
and unresolved selections are labeled explicitly. Lists stay compact and link to
saved-rule review instead of fetching every rule definition for an enable dialog.

`validation-presentation.ts` translates existing validator issues into named
condition/action messages and focusable destinations. It does not change validation.
The builder keeps inline errors, ARIA descriptions, entered values and an error
summary with links. Template rows needing inputs have a neutral “Needs setup” label.

### Save, enable and archive

New rules save disabled. Durable feedback on the detail route says the rule will
not run until enabled and global processing is active. The `saved=disabled` URL
flag is presentation only and is shown only for a currently disabled, unarchived
rule; it carries no draft content or authorization. Existing saves retain expected
version checks and enablement behavior.

Enable confirmation names the saved rule, event, immutable version and derived
summary. The list directs administrators to review the saved definition before
enabling. `automationProcessingActive` reuses the existing admin-only read RPC to
combine deployment and database state (and avoids that read when deployment is
OFF). It performs no writes. The confirmation explains OFF as informational, not
an error. Archive explicitly retains historical versions and execution history.

### Tests, accessibility and layout

The gallery uses native buttons and disclosures; the builder retains native fields,
Move Up/Down actions, focus restoration and reorder announcements. Error-summary
links focus their named field/fieldset. Gallery columns adapt to available space
and stack on compact screens. All styles use existing settings cards, forms,
buttons, semantic alerts, focus and surface tokens; no new palette or animation.

Dry-run results keep “No changes were made.” prominent, separate proposed actions
and warnings, and label retained history and simulated values. Transport errors in
reference/event selection become retryable inline feedback. History adds semantic
timestamps and completion counts while retaining pinned-version rendering and the
distinction between action failure and retry exhaustion. Terminal records without
a duration no longer appear actively processing.

`templates.test.mjs` covers catalog validation, independent disabled drafts,
unresolved inputs, selection/scratch, summaries, validation focus, draft preservation,
confirmation copy, OFF-state authorization, warning presentation and layout rules.
Stage 1–7 regressions remain in the full suite. The isolated browser fixture at
`tests/helpers/automation-ui-preview.mjs` uses real UI and CSS with mocked actions;
it never accesses production or changes processing state.

### Verification for this change

Node 24.21.0: 533 application tests passed (including 18 new template/UX tests and
an additional filter-empty-state case), with zero failures or skips. Typecheck,
zero-warning ESLint and the production build passed with processing OFF.

An isolated Chromium fixture verified keyboard template selection, native select
input, validation-summary links, add/remove/reorder focus, announcements and a
matching unsaved-draft dry run at 1440, 834 and 390 CSS-pixel widths. Gallery,
builder, dry-run, list, history, execution detail and expanded enable/archive
confirmations had no horizontal page overflow. Reduced-motion mode and form labels
were checked. This found and fixed table overflow from absolutely positioned hidden
content at tablet widths, scoped to Automation's grid/scroll regions. The preview
helper also needed explicit TypeScript filenames and UTF-8 HTML; these fixture
fixes do not change application contracts.

These browser checks use synthetic records and mocked actions with non-local
requests blocked. They do not close hosted Supabase/PostgREST, concurrency, runtime
recovery or activation gates. A screen-reader review against the authenticated
application remains a pre-release check. No production request, migration,
deployment change or activation was performed during this UI stage.
