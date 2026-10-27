# Shipped Web UI versus approved prototype

Date: 2026-09-09
Status: Investigated; corrective implementation has not started.

## Question and conclusion

The user reports substantial visual differences after landing the Web UI and running it through `changeloop serve`. Confirmed: the implementation preserves some foundation tokens and the desktop content width, but materially changes navigation, page hierarchy, document reading, change overview, and session branding geometry. Functional test success did not establish fidelity to the approved prototype. The earlier delivery assessment did not adequately check that requirement.

## References and method

- Approved revised prototype: `.foundation/prototypes/changeloop-webui/index.html`, with `data.js` and `prototype.js`. The earlier `before-investigations.html` is not the selected revision.
- Selection and review: `openspec/changes/archive/2026-09-09-add-code-aligned-changeloop-web-ui-with-project-changes-evidence/references/prototype-selection.md` and `references/prototype-review.md`.
- Delivered implementation: commit `6ccd4b743`; local compiled binary `packages/opencode/dist/opencode-darwin-arm64/bin/opencode`, version `0.0.0-webui`, exposed through `/opt/homebrew/bin/changeloop`.
- Compared the real service at `http://127.0.0.1:4096` against the local prototype in BrowserOS Neo. Selected the repository directory explicitly for Changes. Matched dark theme and 1440 × 1000 viewport; inspected investigation list, note reader, the archived UI change overview, and new session. Also checked new session at 390 × 844.
- Browser screenshots were inspected inline during the audit; they are not persisted baseline image artifacts. Session geometry was additionally measured with DOM bounding rectangles.
- This is a visual/structure audit, not a new complete accessibility or backend verification run.

## Confirmed findings

| Priority | Area | Approved prototype | Shipped UI and source |
| --- | --- | --- | --- |
| High | Project navigation | Projects heading, selected project row, Changes / Settings / Help navigation | Server and Project native selects plus server URL replace the sidebar composition. See `packages/app/src/pages/changes.tsx:197` and `:228`. Desktop main x=516 and width=720 are aligned, so the problem is composition rather than the entire grid. |
| High | Investigation list | Project eyebrow, Changes heading with Investigate action, workflow strip, search, underlined category tabs with counts, compact rows and reference badges | Filled category buttons, an additional Investigations heading and toolbar, search below them, long raw timestamps, and pagination footer. Workflow strip and category counts are absent. See `packages/app/src/pages/changes.tsx:261` and `packages/app/src/pages/changes/document-workspace.tsx:133`. |
| High | Investigation reader | Dedicated reader screen with title/actions, source metadata and section navigation beside focused content | Parent list headings and toolbar remain above the reader. The note title repeats through the Markdown heading. A native section dropdown replaces the side navigation, and the full document remains the main body. See `packages/app/src/pages/changes/document-workspace.tsx:267`, `:374`, and `:398`. |
| High | Change overview | Human-readable title, workflow progress, underlined detail tabs, Why summary, research context, facts and agreement-document shortcuts | Parent list controls remain above the detail; the heading falls back to the slug. Overview contains Phase/Lifecycle/Updated followed by the proposal reader, without the intended summary/facts/shortcuts composition. See `packages/app/src/pages/changes/changes-view.tsx:196`, `:235`, and `:243`. |
| Medium | Session wordmark and spacing | Compact wordmark with 32 px following gap | Wordmark SVG has a 720 × 129 viewBox with padded glyphs, changing proportions and pushing the composer down. See `packages/app/src/components/changeloop-brand.tsx` and `packages/app/src/pages/new-session/new-session-view.tsx`. At desktop, prototype logo box is 720 × 58.06 at y=293.51; live SVG box is 720 × 129 at y=285.05. Composer top is approximately y=383.57 versus y=446.05: about 62 px lower. SVG box and painted glyph bounds are distinct; the live prompt-input selector measures the editor, not the complete composer height. |
| Medium | Narrow session layout | At 390 px, composer spans approximately x=23–367, with logo above and project row below | Live composer spans approximately x=32–358 and sits around 49 px lower. Project and Git indicators stack. Neither page has document-level horizontal overflow (`scrollWidth=390`), but lack of overflow does not establish matching layout. |

## Differences that are not established defects

- Active/archive counts differ because the selected change has since been landed. The prototype snapshot is historical; its counts and phase cannot be copied into live state.
- Model names, selected project, branch, and timestamps are real runtime values rather than prototype fixtures.
- The prototype shows a related-change banner for the investigation; the live note did not show the same association. This needs a separate exact-reference check, including archived relative links and copied investigation references, before classifying it as a data bug. Do not infer relationships from matching titles to reproduce the appearance.
- The initial background-tab loading delay was resolved with browser focus emulation and refresh; it was not counted as a product defect.

## Why existing proof missed the drift

`packages/app/e2e/regression/foundation-webui.spec.ts:22`, `:38`, and `:128`, and `packages/app/e2e/regression/foundation-documents.spec.ts:89` capture screenshots. Those suites do not compare them against approved prototype baselines with `toHaveScreenshot`, nor assert the selected prototype's geometry and page hierarchy. Their functional, theme, keyboard, overflow and safety checks have value, but screenshot creation by itself is not visual acceptance.

The implementation built separate generic list/detail/document controls instead of carrying forward the approved screen composition. Passing source-backed data and safety tests did not catch that structural change.

## Corrective change direction

Restore the selected prototype's composition using production components and live data: project navigation; project/title/action hierarchy; workflow strip; counted underlined tabs; compact investigation rows; a dedicated note reader with section navigation; a change overview with proposal-derived title and Why summary, truthful facts and document shortcuts; and the approved wordmark proportions and spacing. Keep safe Markdown rendering, contained file reads, explicit missing values, and draft-only session handoff.

Use proposal metadata for readable title/purpose, Foundation snapshot for lifecycle/evidence/usage, document manifests for available agreement files, and exact validated references for relationships. Rendering a full proposal underneath a slug is not a substitute for the overview summary. Do not fabricate phase completion or evidence to match a historical screenshot.

## Acceptance needed before another visual-fidelity claim

1. Bind the correction to the selected prototype revision and enumerate the matched screen states in design and test cases.
2. Compare desktop and narrow screenshots for investigation list, note reader, change overview, Documents, Tasks, Evidence, Usage, and session handoff in light and dark themes. Use controlled content and explicitly account for legitimate live-data differences.
3. Assert meaningful structure and geometry: dedicated reader/detail screens, sidebar and tab arrangement, title/summary mapping, wordmark aspect ratio, content width and composer placement. Add stable visual baselines only after reviewing them against the approved prototype.
4. Re-run affected functional and safe-reader checks, and verify the final compiled artifact through `changeloop serve` before presenting the paired visual evidence for acceptance.

No product files were edited and no new visual pass is claimed by this investigation.
