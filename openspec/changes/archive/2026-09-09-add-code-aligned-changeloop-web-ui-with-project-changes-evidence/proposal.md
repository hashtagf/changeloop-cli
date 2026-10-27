# Change: Add code-aligned ChangeLoop Web UI with project changes, evidence, session handoff and Changeloop branding

## Why

Developers need project-scoped Foundation status and evidence in the existing app, with a familiar session workflow and Changeloop identity. The selected prototype is grounded in current V2 source. The approved revision also makes saved investigation notes, agreement documents, tasks and source provenance visible before and during Change work.

## What changes

- The server obtains Foundation dashboard snapshot schema 3 from the checksum-pinned 3.5.14 release, including the snapshot dependency closure in the generated bundle. Use tagged source provenance and regenerate the manifest according to docs/FOUNDATION_UPDATE_AGENT.md; never modify upstream payload bytes. Reads neither download runtime code nor initialize or repair project files. Explicit path mode uses only its selected compatible runtime; bundled failures never silently fall back to PATH.
- Expose additive typed read-only capability and changes/detail resources through the existing authenticated location boundary. Project identity is canonicalized server-side; subprocess argv is fixed and allowlisted, never arbitrary user shell. Bound subprocess time to 5 seconds and output to 1 MiB; coalesce reads per project. Use stable errors for invalid input, denied access, missing initialization, unsupported schema/runtime, timeout, oversized output and invalid response, never empty-success on failure. Accept unknown additive snapshot fields but reject unsupported schema versions. Omit ownerEmail and raw packet/command data. Preserve Schema to Core/Protocol to Server dependency direction; host implementation is composed without reverse imports. Regenerate Client from public HttpApi and preserve old clients.
- List active and archived changes separately using deterministic updatedAt descending then ID ordering, with text search and pagination default 50 maximum 100. Use snapshot ID as display fallback rather than inventing titles. Retain diagnostics for skipped malformed entries. Show phase, lifecycle status, evidence status and snapshot generatedAt. Unknown usage remains unavailable, not zero; archived changes are not counted as active. Runtime fields in Overview, Evidence and Usage come only from the supported projection. The document-task-provenance requirement adds source-backed Documents and Tasks views and proposal metadata; do not invent tasks, gates, backlog or next actions from the snapshot.
- Show recordedStatus, current evidence status and freshness separately. Archived remains delivered history even when current evidence cannot be verified. Read history and detail without calling packet or recreating a missing sandbox. A successful process exit or chat response never constitutes proof or Land authority.
- Implement Changes inside the existing V2 app using actual production components, tokens, fonts, top tabs, Home project navigation, compact list/search patterns and responsive behavior. Preserve existing Home/session navigation and the full-width new-session layout with the existing 720px content bound. Do not ship prototype HTML, sample data, copied CSS, fake controls or the rejected green standalone dashboard. Changes detail may introduce necessary UI using existing components. Use accessible names, keyboard navigation, visible focus and non-color state text at desktop and 390px mobile in light/dark modes.
- Key state by server and canonical project/location; discard late responses from another selection. Refresh on entry/focus and every 10 seconds only while visible, with manual refresh. Show loading, empty, disconnected, missing initialization, unsupported capability/schema, malformed diagnostics and stale-last-success distinctly. Preserve prior data with generatedAt on failure and stop polling when hidden or unmounted. An older server without the feature leaves ordinary sessions usable.
- Open a draft in the selected server/project; New change drafts /investigate and an existing change drafts the appropriate supported Foundation phase command or /changes for history. Navigation alone starts no agent or lifecycle mutation and grants no Land authority. Retain the draft for user review and after recoverable failures. At submission use the existing session command API, discovery, permission and question flow; verify the supported V2 path resolves canonical host instructions. Respect foundation_workflow opt-out and user-owned command overrides without overwriting them. No inferred transcript-based association, new lifecycle database or direct Build/Prove/Land control API is added.
- Render Changeloop branding using the established pixel wordmark with circular-arrow O glyphs from the CLI/TUI reference. Keep the existing composer layout, theme contrast and responsive sizing; use a compact Changeloop mark where the legacy empty view uses a mark. Provide an accessible Changeloop name for meaningful branding. Inspect shared callers so unrelated websites, console, desktop icons and provider logos remain outside scope.
- Verify the embedded frontend contains the Changes route and Changeloop session logo and works against the matching API without a standalone Foundation executable. Document that upstream app.opencode.ai fallback does not deliver local custom UI and provide supported local build/run instructions. Scope includes source changes, focused compiled-binary validation and docs, not public release or deployment.

- Add Investigations alongside Active and Archived, reading saved notes without inventing runtime phase/completion. Follow exact contained document references to Changes and draft /investigate or /change through the existing session flow.
- Add bounded typed investigation/document readers and Documents/Tasks views. Read proposal/design/spec/task/evidence-contract files from active or matching archived directories. Show planned test cases separately from proof; expose field-to-source mapping and independent read timestamps.
- Keep snapshot status/evidence/usage available when document reads fail; keep saved research readable when Foundation runtime is absent. Reuse existing authentication/Location and safe Markdown components, with explicit missing/oversized/invalid/unsupported states.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** authenticated project file reads, path/symlink containment, untrusted Markdown/URLs, bounded index and document inputs.

## Non-goals

- Direct Build/Prove/Land controls, inferred lifecycle authority or transcript-based session association.
- A new task/gate database, project initialization/repair on reads, or a global product rebrand.
- Public release/deployment or replacing the existing upstream fallback service.

## Grounding and verification references

- [Investigation](references/investigation.md): observed serve/runtime/projection constraints.
- [Design](design.md): source map R01–R14, decisions DEC-001–DEC-005, component contracts and planned test cases.
- [Delta requirements](specs/foundation-webui/spec.md), [implementation tasks](tasks.md) and [evidence claims](evidence.yaml): 13 requirements with implementation/evidence ownership.
- [Selected prototype](references/prototype-selection.md): local code-aligned design reference, with durable source mapping retained in design.md.

The test matrix defines planned checks; executable tests and product evidence are pending Build/Prove.
