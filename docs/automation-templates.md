# Automation templates and UX polish — Stage 8

This stage adds presentation only. Production alignment/activation remains deferred;
there are no new migrations, engine semantics or processing controls. Earlier
rollout verification records remain separate from this newly approved UI stage.

## Built-in templates

`src/features/automation/templates.ts` defines a small typed, application-owned
catalog: stable ID, name, description, category, use case, guidance and a normal
`AutomationDefinition`. `templateDraft` clones a definition and explicitly returns
`enabled: false`; no template identifier is stored in a rule or passed to execution.

| Template | Starting condition | Action / required administrator input |
| --- | --- | --- |
| Critical Ticket Assignment | Priority equals Critical | Select team |
| Category Based Routing | Select category | Select team |
| Technician Assignment | Select category; editable | Select active technician |
| Priority Adjustment | Select category; editable | Select priority |
| Add Internal Triage Note | Select category; editable | Enter internal note |
| Requester Notification | Priority equals Critical | Standard ticket update to Requester |

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

## Adding a template safely

1. Confirm trigger, fields/operators and actions already exist in the registries.
2. Add a unique stable catalog ID and plain-language metadata. Use a flat AND group
   and contiguous action positions. Keep organization references empty and explain
   required setup; never embed real tenant data, arbitrary code or new semantics.
3. Verify completed drafts against `validateDefinition` with the persistence registry.
   Extend completion fixtures if a new kind of required input is used. Ensure blank
   references stay invalid, draft clones are independent and saving stays disabled.
4. Check gallery/preview labels, builder selection, summaries, dry run and keyboard
   behavior. Do not add template-specific execution or persistence code.

## Derived presentation

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

## Save, enable and archive

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

## Tests, accessibility and layout

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

## Verification for this change

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
