# Visual regression checks

Use these before and after CSS refactors to prove nothing visible changed. The checks render the synthetic interface preview (`tests/helpers/interface-audit-preview.mjs`): real components with fixture data and no credentials, network data, or production access.

```sh
npm run visual:capture -- /tmp/shots-before   # before the change
# …make the change…
npm run visual:capture -- /tmp/shots-after
npm run visual:compare -- /tmp/shots-before /tmp/shots-after /tmp/shots-diff
```

- **Coverage:** 22 screens (staff queue and drawer, ticket creation, help, assets, profile, notifications, administration, chat, editors, report builder, employee home, requests, chat intake, sign-in, technician and platform shells), each in light and dark mode at 1280 px and 390 px wide. That makes 88 images.
- **Repeatable captures:** the clock is fixed and animations, transitions and the text caret are disabled, so two captures of unchanged code match exactly.
- **Engine:** capture uses Playwright Chromium when `PLAYWRIGHT_MODULE` points at an installed Playwright (it is not a project dependency). On macOS it otherwise compiles `scripts/visual-capture.swift` and uses the system WebKit. Only compare captures made with the same engine.
- **Results:** compare prints the number of identical screens, lists any differences with their pixel counts, writes a red-highlighted image for each one to the diff directory, and exits 1 when anything differs.
- **Limits:** screens outside the preview, such as reports, the platform console and ticket detail, are not covered. Add surfaces to the preview and the `screens` list in `scripts/visual-compare.mjs` when you refactor their styles.

## Duplicate CSS rules

`python3 scripts/merge-duplicate-css.py <files>` folds repeated rules (same selectors, same `@layer`/`@media`) together. It skips a pair when a rule between the two copies has equal specificity, sets a related property, and could style the same element. "Same element" is judged from the classes and tags rendered in `src/`. That check is a heuristic, so run the visual comparison before and after. The remaining duplicates are order-dependent overrides, for example base rules re-set inside later media queries; restructure them by hand.
