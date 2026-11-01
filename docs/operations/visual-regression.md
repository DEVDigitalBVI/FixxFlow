# Visual regression checks

Use these before and after CSS refactors to prove nothing visible changed. The checks render the synthetic interface preview (`tests/helpers/interface-audit-preview.mjs`): real components with fixture data and no credentials, network data, or production access.

```sh
npm run visual:capture -- /tmp/shots-before   # before the change
# …make the change…
npm run visual:capture -- /tmp/shots-after
npm run visual:compare -- /tmp/shots-before /tmp/shots-after /tmp/shots-diff
```

- **Coverage:** 28 screens (staff queue and drawer, ticket creation, help, assets, profile, notifications, administration, organization, people and bulk deletion, recovery, chat, editors, report builder, ticket workflow, employee home, requests, chat intake, sign-in, technician and platform shells), each in light and dark mode at 1280 px and 390 px wide. That makes 112 images.
- **Repeatable captures:** the clock is fixed and animations, transitions and the text caret are disabled, so two captures of unchanged code match exactly.
- **Engine:** capture uses Playwright Chromium when `PLAYWRIGHT_MODULE` points at an installed Playwright (it is not a project dependency). On macOS it otherwise compiles `scripts/visual-capture.swift` and uses the system WebKit. Only compare captures made with the same engine.
- **Results:** compare prints the number of identical screens, lists any differences with their pixel counts, writes a red-highlighted image for each one to the diff directory, and exits 1 when anything differs.
- **Limits:** screens outside the preview, such as reports, the platform console and ticket detail, are not covered. Add surfaces to the preview and the `screens` list in `scripts/visual-compare.mjs` when you refactor their styles.

## Duplicate CSS rules

`python3 scripts/merge-duplicate-css.py <files>` folds repeated rules (same selectors, same `@layer`/`@media`) together. It skips a pair when a rule between the two copies has equal specificity, sets a related property, and could style the same element. "Same element" is judged from the classes and tags rendered in `src/`. That check is a heuristic, so run the visual comparison before and after. The remaining duplicates are order-dependent overrides, for example base rules re-set inside later media queries; restructure them by hand.

## Uniform spacing audit

The app uses the UI kit’s 4px scale through `--space-inline` (8px), `--space-group` (16px) and `--space-section` (24px). Spaced stacks and grid pages own their vertical gap; direct text and page headers do not add browser margins. Keep card and page insets aligned, with compact layouts using 16px.

Use the WebKit capture’s optional geometry reports to check horizontal overflow and additional text margins inside spaced layouts:

```sh
LAYOUT_AUDIT=1 npm run visual:capture -- /tmp/spacing-app
node scripts/verify-layout-audit.mjs /tmp/spacing-app
```

Reports are written alongside images as `.png.json`. These measurements supplement visual review; they do not prove keyboard behavior or that every authenticated route is covered.

`node tests/helpers/email-preview.mjs 4398` serves synthetic previews of all 13 generated account emails and eight operational variants. `/manifest.json` lists their paths. Capture each at 560px and 320px, using `scripts/visual-capture.swift --audit`, then pass the output directory to the same verifier. Regenerate account templates with `node scripts/generate-email-templates.mjs` after editing the shared email kit. Browser previews do not replace Gmail/Outlook client acceptance.

The inventory and automation fixtures also compile shared, feature and UI-kit styles through `tests/helpers/styles.mjs`; raw globals alone do not represent the deployed application.
