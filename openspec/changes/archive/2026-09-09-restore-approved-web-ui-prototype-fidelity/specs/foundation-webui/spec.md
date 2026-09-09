# foundation-webui

## ADDED Requirements

### Requirement: prototype-page-composition

The system SHALL Restore the selected revised prototype composition documented in openspec/investigations/changeloop-webui-prototype-drift.md and the archived prototype selection: Home-style Projects navigation, project eyebrow and title/action hierarchy, workflow strip, underlined category tabs with source-backed counts, compact rows, dedicated detail and reader screens without parent list controls. Keep real selection, loading, errors, pagination, keyboard navigation and safe document rendering; absent counts stay unavailable.

#### Scenario: The user browses Investigations, a saved note, or active/archived Change details at desktop and 390px widths in either theme.

- **WHEN** The user browses Investigations, a saved note, or active/archived Change details at desktop and 390px widths in either theme.
- **THEN** Restore the selected revised prototype composition documented in openspec/investigations/changeloop-webui-prototype-drift.md and the archived prototype selection: Home-style Projects navigation, project eyebrow and title/action hierarchy, workflow strip, underlined category tabs with source-backed counts, compact rows, dedicated detail and reader screens without parent list controls. Keep real selection, loading, errors, pagination, keyboard navigation and safe document rendering; absent counts stay unavailable.

### Requirement: prototype-overview-reader

The system SHALL Show a proposal-derived readable title and Why summary with ID fallback, truthful snapshot facts and agreement document shortcuts; keep runtime information when documents fail. Present note/document section navigation beside focused safe Markdown content, with a full-source option and exact reference navigation. Never synthesize history, completion or links from visual fixtures.

#### Scenario: A Change has available, missing or failed proposal/documents, or a note contains multiple sections and duplicate headings.

- **WHEN** A Change has available, missing or failed proposal/documents, or a note contains multiple sections and duplicate headings.
- **THEN** Show a proposal-derived readable title and Why summary with ID fallback, truthful snapshot facts and agreement document shortcuts; keep runtime information when documents fail. Present note/document section navigation beside focused safe Markdown content, with a full-source option and exact reference navigation. Never synthesize history, completion or links from visual fixtures.

### Requirement: prototype-session-geometry

The system SHALL Match the selected compact CLI pixel wordmark aspect ratio and following 32px gap, 720px desktop content bound, and prototype narrow-screen insets, without SVG padding that pushes the composer down. Preserve production composer behavior, accessible branding, selected project/server and no automatic submission.

#### Scenario: A user opens a new session or draft through Changes at 1440x1000 and 390x844.

- **WHEN** A user opens a new session or draft through Changes at 1440x1000 and 390x844.
- **THEN** Match the selected compact CLI pixel wordmark aspect ratio and following 32px gap, 720px desktop content bound, and prototype narrow-screen insets, without SVG padding that pushes the composer down. Preserve production composer behavior, accessible branding, selected project/server and no automatic submission.

### Requirement: prototype-visual-regression

The system SHALL Verify matched representative screen states in both themes and desktop/mobile with meaningful hierarchy and geometry assertions plus reviewed paired screenshots against the selected prototype. Screenshot capture alone is not visual acceptance. Keep existing functional safety and draft-handoff regressions passing; record actual inspected states and remaining limits.

#### Scenario: The corrected UI is checked before delivery through an embedded local changeloop serve build.

- **WHEN** The corrected UI is checked before delivery through an embedded local changeloop serve build.
- **THEN** Verify matched representative screen states in both themes and desktop/mobile with meaningful hierarchy and geometry assertions plus reviewed paired screenshots against the selected prototype. Screenshot capture alone is not visual acceptance. Keep existing functional safety and draft-handoff regressions passing; record actual inspected states and remaining limits.
