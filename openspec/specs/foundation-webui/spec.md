# foundation-webui Specification

## Purpose
TBD - created by archiving change add-code-aligned-changeloop-web-ui-with-project-changes-evidence. Update Purpose after archive.
## Requirements
### Requirement: bundled-projection

The system SHALL obtain Foundation dashboard snapshot schema 3 from the checksum-pinned 3.5.14 release, including the snapshot dependency closure in the generated bundle. Use tagged source provenance and regenerate the manifest according to docs/FOUNDATION_UPDATE_AGENT.md; never modify upstream payload bytes. Reads neither download runtime code nor initialize or repair project files. Explicit path mode uses only its selected compatible runtime; bundled failures never silently fall back to PATH.

#### Scenario: A compiled Changeloop binary reads initialized project changes without external claude-foundation on PATH.

- **WHEN** A compiled Changeloop binary reads initialized project changes without external claude-foundation on PATH.
- **THEN** The server obtains Foundation dashboard snapshot schema 3 from the checksum-pinned 3.5.14 release, including the snapshot dependency closure in the generated bundle. Use tagged source provenance and regenerate the manifest according to docs/FOUNDATION_UPDATE_AGENT.md; never modify upstream payload bytes. Reads neither download runtime code nor initialize or repair project files. Explicit path mode uses only its selected compatible runtime; bundled failures never silently fall back to PATH.

### Requirement: scoped-read-api

The system SHALL expose additive typed read-only capability and changes/detail resources through the existing authenticated location boundary. Project identity is canonicalized server-side; subprocess argv is fixed and allowlisted, never arbitrary user shell. Bound subprocess time to 5 seconds and output to 1 MiB; coalesce reads per project. Use stable errors for invalid input, denied access, missing initialization, unsupported schema/runtime, timeout, oversized output and invalid response, never empty-success on failure. Accept unknown additive snapshot fields but reject unsupported schema versions. Omit ownerEmail and raw packet/command data. Preserve Schema to Core/Protocol to Server dependency direction; host implementation is composed without reverse imports. Regenerate Client from public HttpApi and preserve old clients.

#### Scenario: A Web UI client requests changes for its selected server and project/location, including invalid IDs, foreign locations and unavailable runtimes.

- **WHEN** A Web UI client requests changes for its selected server and project/location, including invalid IDs, foreign locations and unavailable runtimes.
- **THEN** Expose additive typed read-only capability and changes/detail resources through the existing authenticated location boundary. Project identity is canonicalized server-side; subprocess argv is fixed and allowlisted, never arbitrary user shell. Bound subprocess time to 5 seconds and output to 1 MiB; coalesce reads per project. Use stable errors for invalid input, denied access, missing initialization, unsupported schema/runtime, timeout, oversized output and invalid response, never empty-success on failure. Accept unknown additive snapshot fields but reject unsupported schema versions. Omit ownerEmail and raw packet/command data. Preserve Schema to Core/Protocol to Server dependency direction; host implementation is composed without reverse imports. Regenerate Client from public HttpApi and preserve old clients.

### Requirement: bounded-change-list

The system SHALL list active and archived changes separately using deterministic updatedAt descending then ID ordering, with text search and pagination default 50 maximum 100. Use snapshot ID as display fallback rather than inventing titles. Retain diagnostics for skipped malformed entries. Show phase, lifecycle status, evidence status and snapshot generatedAt. Unknown usage remains unavailable, not zero; archived changes are not counted as active. Runtime fields in Overview, Evidence and Usage come only from the supported projection. The document-task-provenance requirement adds source-backed Documents and Tasks views and proposal metadata; do not invent tasks, gates, backlog or next actions from the snapshot.

#### Scenario: A project has active and archived changes, many entries, unknown measurements or malformed snapshot entries.

- **WHEN** A project has active and archived changes, many entries, unknown measurements or malformed snapshot entries.
- **THEN** List active and archived changes separately using deterministic updatedAt descending then ID ordering, with text search and pagination default 50 maximum 100. Use snapshot ID as display fallback rather than inventing titles. Retain diagnostics for skipped malformed entries. Show phase, lifecycle status, evidence status and snapshot generatedAt. Unknown usage remains unavailable, not zero; archived changes are not counted as active. Runtime fields in Overview, Evidence and Usage come only from the supported projection. The document-task-provenance requirement adds source-backed Documents and Tasks views and proposal metadata; do not invent tasks, gates, backlog or next actions from the snapshot.

### Requirement: truthful-evidence

The system SHALL show recordedStatus, current evidence status and freshness separately. Archived remains delivered history even when current evidence cannot be verified. Read history and detail without calling packet or recreating a missing sandbox. A successful process exit or chat response never constitutes proof or Land authority.

#### Scenario: A recorded pass is stale/unverified, or an archived change no longer has a sandbox.

- **WHEN** A recorded pass is stale/unverified, or an archived change no longer has a sandbox.
- **THEN** Show recordedStatus, current evidence status and freshness separately. Archived remains delivered history even when current evidence cannot be verified. Read history and detail without calling packet or recreating a missing sandbox. A successful process exit or chat response never constitutes proof or Land authority.

### Requirement: existing-ui-design

The system SHALL implement Changes inside the existing V2 app using actual production components, tokens, fonts, top tabs, Home project navigation, compact list/search patterns and responsive behavior. Preserve existing Home/session navigation and the full-width new-session layout with the existing 720px content bound. Do not ship prototype HTML, sample data, copied CSS, fake controls or the rejected green standalone dashboard. Changes detail may introduce necessary UI using existing components. Use accessible names, keyboard navigation, visible focus and non-color state text at desktop and 390px mobile in light/dark modes.

#### Scenario: The user opens Changes, Home or a session from the selected code-aligned prototype.

- **WHEN** The user opens Changes, Home or a session from the selected code-aligned prototype.
- **THEN** Implement Changes inside the existing V2 app using actual production components, tokens, fonts, top tabs, Home project navigation, compact list/search patterns and responsive behavior. Preserve existing Home/session navigation and the full-width new-session layout with the existing 720px content bound. Do not ship prototype HTML, sample data, copied CSS, fake controls or the rejected green standalone dashboard. Changes detail may introduce necessary UI using existing components. Use accessible names, keyboard navigation, visible focus and non-color state text at desktop and 390px mobile in light/dark modes.

### Requirement: refresh-and-failure-states

The system SHALL key state by server and canonical project/location; discard late responses from another selection. Refresh on entry/focus and every 10 seconds only while visible, with manual refresh. Show loading, empty, disconnected, missing initialization, unsupported capability/schema, malformed diagnostics and stale-last-success distinctly. Preserve prior data with generatedAt on failure and stop polling when hidden or unmounted. An older server without the feature leaves ordinary sessions usable.

#### Scenario: A user changes server/project during a request, returns to the page, or loses connection while viewing changes.

- **WHEN** A user changes server/project during a request, returns to the page, or loses connection while viewing changes.
- **THEN** Key state by server and canonical project/location; discard late responses from another selection. Refresh on entry/focus and every 10 seconds only while visible, with manual refresh. Show loading, empty, disconnected, missing initialization, unsupported capability/schema, malformed diagnostics and stale-last-success distinctly. Preserve prior data with generatedAt on failure and stop polling when hidden or unmounted. An older server without the feature leaves ordinary sessions usable.

### Requirement: session-draft-handoff

The system SHALL open a draft in the selected server/project; New change drafts /investigate and an existing change drafts the appropriate supported Foundation phase command or /changes for history. Navigation alone starts no agent or lifecycle mutation and grants no Land authority. Retain the draft for user review and after recoverable failures. At submission use the existing session command API, discovery, permission and question flow; verify the supported V2 path resolves canonical host instructions. Respect foundation_workflow opt-out and user-owned command overrides without overwriting them. No inferred transcript-based association, new lifecycle database or direct Build/Prove/Land control API is added.

#### Scenario: A user chooses New change or Open session for a listed change and then explicitly submits its command.

- **WHEN** A user chooses New change or Open session for a listed change and then explicitly submits its command.
- **THEN** Open a draft in the selected server/project; New change drafts /investigate and an existing change drafts the appropriate supported Foundation phase command or /changes for history. Navigation alone starts no agent or lifecycle mutation and grants no Land authority. Retain the draft for user review and after recoverable failures. At submission use the existing session command API, discovery, permission and question flow; verify the supported V2 path resolves canonical host instructions. Respect foundation_workflow opt-out and user-owned command overrides without overwriting them. No inferred transcript-based association, new lifecycle database or direct Build/Prove/Land control API is added.

### Requirement: changeloop-session-brand

The system SHALL render Changeloop branding using the established pixel wordmark with circular-arrow O glyphs from the CLI/TUI reference. Keep the existing composer layout, theme contrast and responsive sizing; use a compact Changeloop mark where the legacy empty view uses a mark. Provide an accessible Changeloop name for meaningful branding. Inspect shared callers so unrelated websites, console, desktop icons and provider logos remain outside scope.

#### Scenario: The user opens a new or empty session in V2 and the still-supported legacy layout, including through Changes.

- **WHEN** The user opens a new or empty session in V2 and the still-supported legacy layout, including through Changes.
- **THEN** Render Changeloop branding using the established pixel wordmark with circular-arrow O glyphs from the CLI/TUI reference. Keep the existing composer layout, theme contrast and responsive sizing; use a compact Changeloop mark where the legacy empty view uses a mark. Provide an accessible Changeloop name for meaningful branding. Inspect shared callers so unrelated websites, console, desktop icons and provider logos remain outside scope.

### Requirement: embedded-ui-delivery

The system SHALL verify the embedded frontend contains the Changes route and Changeloop session logo and works against the matching API without a standalone Foundation executable. Document that upstream app.opencode.ai fallback does not deliver local custom UI and provide supported local build/run instructions. Scope includes source changes, focused compiled-binary validation and docs, not public release or deployment.

#### Scenario: The built binary serves the app through serve or web with embedded assets.

- **WHEN** The built binary serves the app through serve or web with embedded assets.
- **THEN** Verify the embedded frontend contains the Changes route and Changeloop session logo and works against the matching API without a standalone Foundation executable. Document that upstream app.opencode.ai fallback does not deliver local custom UI and provide supported local build/run instructions. Scope includes source changes, focused compiled-binary validation and docs, not public release or deployment.

### Requirement: investigation-library

The system SHALL expose saved openspec/investigations/*.md notes as an Investigations category alongside Active and Archived in Changes. Display heading or filename fallback, source path, filesystem modified time and readable note sections. Saved notes do not imply running/completed workflow status; unsaved investigations remain in Sessions. Associate a note with a Change only from an exact contained document reference, never title or transcript similarity; a reference is not conversion or completion. List without Foundation runtime initialization, distinguish unsupported reader, absent directory and failed reads, and preserve ordinary sessions.

#### Scenario: A selected project contains saved investigation notes, including a note with an explicit Change reference and a session with no saved note.

- **WHEN** A selected project contains saved investigation notes, including a note with an explicit Change reference and a session with no saved note.
- **THEN** expose saved openspec/investigations/*.md notes as an Investigations category alongside Active and Archived in Changes. Display heading or filename fallback, source path, filesystem modified time and readable note sections. Saved notes do not imply running/completed workflow status; unsaved investigations remain in Sessions. Associate a note with a Change only from an exact contained document reference, never title or transcript similarity; a reference is not conversion or completion. List without Foundation runtime initialization, distinguish unsupported reader, absent directory and failed reads, and preserve ordinary sessions.

### Requirement: safe-document-reader

The system SHALL provide additive typed Location-scoped bounded investigation and document reads. Resolve opaque server-issued document IDs under canonical allowed roots; reject traversal, symlink escape, non-regular files and ambiguous archive matches. Allow only investigation Markdown and proposal.md, design.md, tasks.md, evidence.yaml, grounding.yaml and specs/**/*.md for the selected Change. Return source path, modifiedAt, readAt, content digest and text; cap individual UTF-8 documents at 256 KiB and aggregate responses at 1 MiB, paginate indexes 50 default/100 max with bounded scans. Render Markdown safely with no raw HTML, executable URLs or automatic remote resource fetches. Missing/invalid/oversized documents remain explicit per-document states; no GET writes, packet execution, sandbox recreation or generic filesystem API. Preserve auth/dependency direction and regenerate the client actually consumed by app.

#### Scenario: An authorized client lists or opens a saved note or active/archived Change document, including missing, malformed, oversized and escaping paths.

- **WHEN** An authorized client lists or opens a saved note or active/archived Change document, including missing, malformed, oversized and escaping paths.
- **THEN** provide additive typed Location-scoped bounded investigation and document reads. Resolve opaque server-issued document IDs under canonical allowed roots; reject traversal, symlink escape, non-regular files and ambiguous archive matches. Allow only investigation Markdown and proposal.md, design.md, tasks.md, evidence.yaml, grounding.yaml and specs/**/*.md for the selected Change. Return source path, modifiedAt, readAt, content digest and text; cap individual UTF-8 documents at 256 KiB and aggregate responses at 1 MiB, paginate indexes 50 default/100 max with bounded scans. Render Markdown safely with no raw HTML, executable URLs or automatic remote resource fetches. Missing/invalid/oversized documents remain explicit per-document states; no GET writes, packet execution, sandbox recreation or generic filesystem API. Preserve auth/dependency direction and regenerate the client actually consumed by app.

### Requirement: document-task-provenance

The system SHALL extend Change details with Documents and Tasks beside Overview, Evidence and Usage. Read title and Why from proposal.md with ID fallback; read the full available agreement documents, the tasks.md checkbox ledger, planned test cases from design.md and scenarios from specs. Checked tasks and evidence.yaml claims are declarations, never proof results. Evidence status/recordedStatus/freshness/providers remain snapshot-owned; budgets, run branch and operationMs remain projection-owned. Label each source and capture time, treat null usage as unavailable, and keep runtime status usable when document reads fail. Data sources explains the field mapping; do not fabricate gates, next actions or task graph state.

#### Scenario: The user inspects a Change whose projection, agreement files, task checkboxes and evidence obligations have different availability or progress.

- **WHEN** The user inspects a Change whose projection, agreement files, task checkboxes and evidence obligations have different availability or progress.
- **THEN** extend Change details with Documents and Tasks beside Overview, Evidence and Usage. Read title and Why from proposal.md with ID fallback; read the full available agreement documents, the tasks.md checkbox ledger, planned test cases from design.md and scenarios from specs. Checked tasks and evidence.yaml claims are declarations, never proof results. Evidence status/recordedStatus/freshness/providers remain snapshot-owned; budgets, run branch and operationMs remain projection-owned. Label each source and capture time, treat null usage as unavailable, and keep runtime status usable when document reads fail. Data sources explains the field mapping; do not fabricate gates, next actions or task graph state.

### Requirement: investigation-draft-navigation

The system SHALL preserve selected server/project while navigating note sections, Change details and the existing session composer. Continue investigation drafts /investigate with the note reference; Draft change drafts /change with the note reference; New investigate drafts /investigate. Opening a draft executes nothing and grants no lifecycle authority. Use existing command discovery, opt-out/override, explicit submission and recoverable draft behavior. Note/document/tab controls work with keyboard, visible focus, non-color labels and 390px/desktop light/dark layouts, using existing V2 components and unchanged session branding/composer. Restore route selection on back/forward without inferring workflow transitions.

#### Scenario: The user browses a saved note, follows its explicit Change reference, or chooses Continue investigation, Draft change or New investigate.

- **WHEN** The user browses a saved note, follows its explicit Change reference, or chooses Continue investigation, Draft change or New investigate.
- **THEN** preserve selected server/project while navigating note sections, Change details and the existing session composer. Continue investigation drafts /investigate with the note reference; Draft change drafts /change with the note reference; New investigate drafts /investigate. Opening a draft executes nothing and grants no lifecycle authority. Use existing command discovery, opt-out/override, explicit submission and recoverable draft behavior. Note/document/tab controls work with keyboard, visible focus, non-color labels and 390px/desktop light/dark layouts, using existing V2 components and unchanged session branding/composer. Restore route selection on back/forward without inferring workflow transitions.

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
