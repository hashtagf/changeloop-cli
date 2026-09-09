# Visual correction review — 2026-09-09

## Result and reference

The major drift documented in `openspec/investigations/changeloop-webui-prototype-drift.md` is corrected. The comparison target remains the selected revised `.foundation/prototypes/changeloop-webui/index.html`, not the earlier prototype. This is Build verification, not a Foundation Proof or Land receipt.

The compiled app is running through `changeloop serve --hostname 127.0.0.1 --port 4096`. The matching embedded frontend, API, authenticated fixture and absence of a standalone Foundation executable were checked by the existing compiled verification scripts.

## Visual findings after correction

- Project navigation, project/title/action hierarchy, workflow, search and counted underlined category tabs replace the former Server/Project form and nested toolbars. The desktop search is 720px wide at x=516 and 36px high. Rows are compact; counts reflect current sources rather than historical prototype values.
- Notes have a dedicated screen, one display title, explicit reference state and side section navigation. Findings/Summary opens first; switching sections changes focused content, including stable route restoration. Safe full-source reading remains available.
- Change details replace list controls, read the real proposal heading, show a Why excerpt and source-backed facts with agreement shortcuts, and place draft continuation in the footer. Documents have side document navigation; Tasks and Evidence avoid rendering a duplicate full source below their structured views. Detail tabs stay on one scrollable row on narrow screens.
- The wordmark uses the prototype's 310:25 pixel geometry. The padded SVG that displaced the composer has been removed. Production composer controls remain in use.

Final live DOM measurements, taken from the running port 4096 binary and the local prototype:

| Viewport | Measurement | Live | Prototype |
| --- | --- | --- | --- |
| 1440 × 1000 | Logo x / width / height | 360 / 720 / 58.0625 | 360 / 720 / 58.0625 |
| 1440 × 1000 | Logo top | 293.046875 | 293.5078125 |
| 1440 × 1000 | Composer top | 383.109375 | 383.5703125 |
| 390 × 844 | Logo x / width / height | 24 / 342 / 27.578125 | 24 / 342 / 27.578125 |
| 390 × 844 | Logo top | 226.796875 | 227.59375 |
| 390 × 844 | Composer top | 286.375 | 287.171875 |

The live prompt-input selector measures the editor rather than the complete composer; only its top is compared. Both implementations retain 32px between the logo box and composer. These numbers are not a pixel-equality claim for every screen.

## Executed checks

- App typecheck and unit suite: 738 passed, 0 failed. New excerpt tests cover explicit/default/invalid anchors, nested headings, CRLF, missing Why and unstructured notes.
- `packages/opencode/script/verify-foundation-documents.ts`: 8 backend reader tests, existing consumer checks, browser typecheck, compiled asset matching and 8 browser cases passed. New assertions check grid geometry, control order, one note title, focused sections, proposal title/Why and dedicated overview composition.
- `packages/opencode/script/verify-foundation-webui.ts`: generated-client consistency, affected package typechecks, command/delivery checks and 9 browser cases passed. Branding checks assert aspect ratio, following gap and viewport-relative vertical position. Existing auth, archive, stale retry, keyboard, unavailable-versus-zero and draft-only behavior remain checked.
- The new overview browser assertion initially failed because the index title was `proposal.md`; the implementation now reads the actual proposal heading. This demonstrates the assertion catches a source-to-display defect rather than merely collecting an image.
- `git diff --check` passed.

## Retained screenshots and limits

Representative compiled fixture screenshots are retained beside this report:

- [List, light](screenshots/prototype-list-light.png), [list, dark](screenshots/prototype-list-dark.png)
- [Overview, light](screenshots/prototype-overview-light.png), [overview, dark](screenshots/prototype-overview-dark.png)
- [Documents](screenshots/prototype-Documents-dark.png), [Tasks on mobile](screenshots/prototype-Tasks-light-mobile.png)
- [Evidence on mobile](screenshots/prototype-Evidence-dark-mobile.png), [Usage](screenshots/prototype-Usage-light.png)
- [Note, dark](screenshots/documents-dark.png), [note, mobile light](screenshots/documents-light.png)
- [Session draft, dark desktop](screenshots/foundation-dark-draft.png), [session draft, light mobile](screenshots/foundation-light-draft.png)

Direct BrowserOS paired inspection covered the live repository list, note, overview and session alongside the selected prototype; session geometry was measured at both sizes. Fixture captures cover all detail tabs in both themes and sizes. Representative Documents, Tasks, Evidence and Usage captures were additionally inspected as images. This is not a complete accessibility audit or a reviewed image baseline for every possible state.

Legitimate differences remain: the production titlebar and composer controls are preserved; live data, project/workspace selectors, count/history changes and unavailable fields differ from captured examples. The existing public API does not expose contract revision or blocker count, so those cells say Unavailable. The investigation index does not return reference badges; list rows show the saved timestamp and the opened reader resolves exact references. No association was fabricated to reproduce the prototype's historical banner. The prototype's renderer is not shipped.
