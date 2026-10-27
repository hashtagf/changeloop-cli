# Change: Restore approved Web UI prototype fidelity

## Why

The shipped UI materially drifted from the selected code-aligned prototype; correct the audited composition and geometry defects using existing production components and data sources.

## What changes

- Restore the selected revised prototype composition documented in openspec/investigations/changeloop-webui-prototype-drift.md and the archived prototype selection: Home-style Projects navigation, project eyebrow and title/action hierarchy, workflow strip, underlined category tabs with source-backed counts, compact rows, dedicated detail and reader screens without parent list controls. Keep real selection, loading, errors, pagination, keyboard navigation and safe document rendering; absent counts stay unavailable.
- Show a proposal-derived readable title and Why summary with ID fallback, truthful snapshot facts and agreement document shortcuts; keep runtime information when documents fail. Present note/document section navigation beside focused safe Markdown content, with a full-source option and exact reference navigation. Never synthesize history, completion or links from visual fixtures.
- Match the selected compact CLI pixel wordmark aspect ratio and following 32px gap, 720px desktop content bound, and prototype narrow-screen insets, without SVG padding that pushes the composer down. Preserve production composer behavior, accessible branding, selected project/server and no automatic submission.
- Verify matched representative screen states in both themes and desktop/mobile with meaningful hierarchy and geometry assertions plus reviewed paired screenshots against the selected prototype. Screenshot capture alone is not visual acceptance. Keep existing functional safety and draft-handoff regressions passing; record actual inspected states and remaining limits.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- none
