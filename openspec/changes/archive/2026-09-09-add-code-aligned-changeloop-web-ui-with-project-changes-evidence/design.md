# Design

## Agreement and reading guide

This document specifies the implementation of the 13 requirements in [the delta spec](specs/foundation-webui/spec.md). [Tasks](tasks.md) remains the sole completion ledger; [evidence.yaml](evidence.yaml) owns the claim IDs and provider command. Test cases below are planned assertions, not executed results. The previous generated placeholders did not establish implementation readiness.

The selected direction is the existing V2 interface with Investigations / Active / Archived, readable research notes and agreement documents, Tasks / Evidence / Usage, explicit session draft handoff, and Changeloop branding on new/empty sessions. The user approved incorporating the reviewed investigation/document prototype on 2026-09-09; revision 1 adds four requirements to the existing nine. The [investigation](references/investigation.md) records discovery. The [prototype selection](references/prototype-selection.md) and [interactive prototype](../../../.foundation/prototypes/changeloop-webui/index.html) are local design references. The prototype is reconstructed HTML using copied production assets, not mounted Solid components or live data. The approved revision captures actual local notes/documents and a schema-3 snapshot; captured counts and timestamps are examples, not acceptance thresholds. Its simulated send and simple Markdown renderer are not product acceptance evidence. [Revision details](references/prototype-review.md) record the reviewed behavior and limitations. Since `.foundation` references are local/ignored, the source map, decisions, layout constraints and acceptance matrix are preserved here for reviewers without those artifacts.

## Verified current state and source references

Links below resolve from this change directory to repository sources. Symbols, rather than frozen line numbers, identify the relevant behavior. These are current implementation anchors; proposed additions are explicitly identified later.

| Ref | Existing source / symbol | Finding and consequence |
|---|---|---|
| R01 | [serve.ts](../../../packages/opencode/src/cli/cmd/serve.ts), [web.ts](../../../packages/opencode/src/cli/cmd/web.ts), [shared/ui.ts](../../../packages/opencode/src/server/shared/ui.ts) | Both commands use the server. `web` opens a browser; `serve` does not. UI delivery uses embedded assets when available, otherwise upstream `app.opencode.ai`; upstream fallback cannot deliver this custom UI. |
| R02 | [foundation-runtime.ts](../../../packages/opencode/src/plugin/foundation-runtime.ts) | Existing runtime materialization, checksum and explicit bundled/path selection belong to the host package. Installation status alone does not establish snapshot schema compatibility. |
| R03 | [sync-foundation.ts](../../../packages/opencode/script/sync-foundation.ts), [update runbook](../../../docs/FOUNDATION_UPDATE_AGENT.md) | Bundle roots omit the dashboard dependency closure. Pinned 3.5.14 source and regenerated manifest are required; editing vendored upstream implementation bytes is not the update process. |
| R04 | [bundled cli.sh](../../../packages/opencode/vendor/claude-foundation/payload/cli.sh) | The dashboard command requires dashboard/client.sh before snapshot dispatch. Running the current payload snapshot failed on that missing file; copying snapshot.mjs alone is insufficient. |
| R05 | [API composition](../../../packages/opencode/src/server/routes/instance/httpapi/api.ts), [server composition](../../../packages/opencode/src/server/routes/instance/httpapi/server.ts), [Protocol API](../../../packages/protocol/src/api.ts), [Location](../../../packages/server/src/location.ts) | Existing authentication and Location middleware establish request placement. Host implementation must be injected at composition, with no Server import from opencode. |
| R06 | [project-copy group](../../../packages/protocol/src/groups/project-copy.ts), [Client package](../../../packages/client/package.json), [app package](../../../packages/app/package.json) | Typed groups/errors and generated clients already exist. App currently consumes a vendored client tarball, so regeneration in packages/client alone does not update its imported client. |
| R07 | [Home](../../../packages/app/src/pages/home.tsx), [project list](../../../packages/app/src/pages/home/home-projects-view.tsx), [session list](../../../packages/app/src/pages/home/home-sessions-view.tsx) | Existing raised Home surface: 8px margin, 10px radius, 1080px grid, 280px project column and 32px gap; compact search/list patterns are the baseline. |
| R08 | [Titlebar](../../../packages/app/src/components/titlebar.tsx), [Tabs](../../../packages/app/src/context/tabs.tsx), [app routes](../../../packages/app/src/app.tsx), [V2 layout](../../../packages/app/src/pages/layout-new.tsx) | Tabs currently represent sessions/drafts. Changes requires real route/tab integration and selection state; prototype tab switching is not reusable production state. |
| R09 | [new session](../../../packages/app/src/pages/new-session/new-session-view.tsx), [layout bounds](../../../packages/app/src/pages/session/new-session-layout.ts), [V2 composer](../../../packages/session-ui/src/v2/components/prompt-input/index.tsx) | Preserve the 720px content bound, 25.375% desktop top placement, 32px spacing and existing composer. Composer has 12px rounding, 60px editor minimum and 44px controls. |
| R10 | [server SDK context](../../../packages/app/src/context/server-sdk.tsx), [SDK context](../../../packages/app/src/context/sdk.tsx), [compatibility API](../../../packages/app/src/utils/server-compat.ts), [submit](../../../packages/app/src/components/prompt-input/submit.ts) | UI uses selected server/directory and protocol-sensitive session APIs. createCompatibleApi chooses the current API for V2; its legacy command branch is not proof that V2 runs Foundation hooks. |
| R11 | [Foundation plugin](../../../packages/opencode/src/plugin/foundation.ts), [legacy prompt](../../../packages/opencode/src/session/prompt.ts), [CommandV2](../../../packages/core/src/command.ts) | Existing Foundation injection/dispatch honors opt-out and overrides. The discovered execute-before hook is in the legacy path; CommandV2 is a registry, not proof of equivalent execution. V2 dispatch needs an actual integration assertion. |
| R12 | [TUI logo](../../../packages/tui/src/logo.ts), [V2 wordmark](../../../packages/ui/src/v2/components/wordmark-v2.tsx), [legacy empty session](../../../packages/app/src/components/session/session-new-view.tsx), [shared logo](../../../packages/ui/src/components/logo.tsx) | Use the established pixel CHANGE/LOOP with arrow O glyphs. Replace only session-specific branding call sites after checking shared consumers. |
| R13 | [colors](../../../packages/ui/src/v2/styles/colors.css), [theme](../../../packages/ui/src/v2/styles/theme.css), [button](../../../packages/ui/src/v2/components/button-v2.css) | Import actual production components/tokens. Do not ship prototype copies of CSS/fonts or introduce a separate theme. |
| R14 | [Location integration tests](../../../packages/opencode/test/server/httpapi-v2-location.test.ts), [authorization tests](../../../packages/opencode/test/server/httpapi-authorization.test.ts), [browser config](../../../packages/app/playwright.config.ts), [session layout regression](../../../packages/app/e2e/regression/new-session-panel-corner.spec.ts) | Extend existing real-server fixtures and browser topology. Tests run in package directories; visual checks must exercise the production app. |

Additional read anchors for revision 1:

| Ref | Existing source | Finding and consequence |
|---|---|---|
| R15 | [Investigate command](../../../.claude/commands/investigate.md), [Web UI note](references/investigation.md), [Model Router note](../../investigations/phase-1-1-model-router.md) | Saved notes are Markdown, with differing section labels and no mandatory lifecycle metadata. Read actual sections; do not infer running/completed state or normalize missing fields into invented facts. |
| R16 | [Proposal](proposal.md), [tasks ledger](tasks.md), [delta scenarios](specs/foundation-webui/spec.md), [evidence contract](evidence.yaml) | Agreement content, checkboxes, test plans and evidence obligations live outside the snapshot. Source-backed reads extend the original projection-only detail scope. |
| R17 | [Selected reader prototype](references/prototype-selection.md), [revision notes](references/prototype-review.md) | Approved layout adds Investigations / Documents / Tasks and source mapping using actual captured files. Its existing body references link this note to the Change; this is not a conversion receipt. |

Projection discovery also used the locally installed `/opt/homebrew/Cellar/claude-foundation/3.5.14/libexec/dashboard/snapshot.mjs`. This is a development-machine reference, not a runtime dependency. Its schema-3 snapshot includes active/archive, evidence and usage projections; it does not provide task/gate/next-action records. An archived packet failed with FOUNDATION_WORKSPACE_MISSING while snapshot history remained readable. Build must reproduce these findings with the pinned bundled artifact and fixtures, not depend on Homebrew paths.

## Domain language

| Term | Meaning |
|---|---|
| Project/location | Server-resolved filesystem placement using existing Location middleware; never a browser-provided shell working directory. |
| Snapshot | Bounded, versioned read projection from the selected Foundation runtime. Not a packet, command authority or proof receipt. |
| Archived | Delivered history. Current evidence may be unverifiable without its old workspace; that does not undo delivery history. |
| recordedStatus / status / freshness | What was recorded / what the current projection reports / whether the content binding is current. Display separately. |
| Draft | Editable composer content in the selected server/project. No session command runs until explicit submit. |
| Unsupported | Server/runtime cannot provide this feature. Distinct from a supported project with zero changes. |

## Component design

### D1. Read the pinned projection through a host adapter


The dependency flow is Schema → Core and Protocol → Server. Add projection schemas in Schema, a small read-service port in Core, typed HTTP declarations in Protocol, and handlers in Server. The opencode host provides the implementation using its existing Foundation runtime resolver at R05 composition. Neither Server nor Client imports the opencode runtime. Client imports only generated Protocol/Schema contracts.

The adapter resolves the selected runtime, invokes fixed argv `dashboard snapshot --json` with the canonical project root as cwd, bounds elapsed execution to 5 seconds and total captured output to 1 MiB, and terminates the child on either bound. Do not interpolate search, IDs or location into a shell command. Coalesce simultaneous reads by canonical project plus selected runtime identity; release the entry on success/failure and do not retain a rejected promise. HTTP list/detail filtering uses the decoded snapshot, not additional shell calls. A read never calls init, repair, packet or sandbox recreation.

Extend the sync dependency roots from pinned release source to include the complete dashboard execution closure, regenerate checksums and verify the binary under a PATH without Foundation. Explicit path mode uses that chosen runtime and reports incompatible/missing runtime; bundled failures do not fall back silently. No first-request download is allowed.

### D2. Add a narrow typed read contract


Proposed resources, under existing authenticated Location middleware:

| Resource | Input | Result |
|---|---|---|
| GET /experimental/foundation/capability | Existing Location query/header | Located capability: availability, selected runtime version when known, supported snapshot schema; initialization state is distinct from runtime availability. |
| GET /experimental/foundation/changes | Location; scope active/archive (default active), search text, offset (default 0), limit (default 50, maximum 100) | Located list: generatedAt, items, total, nextOffset or null, malformed-entry diagnostics. |
| GET /experimental/foundation/changes/:changeID | Location; validated opaque change ID | Located detail from the same supported projection, including archived entries. |

These paths and field names are design choices for the existing scoped-read-api requirement; they are additions, not replacements for session APIs. Use existing Location response conventions (R05). Canonicalize the selected location before subprocess execution and keying state. Do not interpret an ID as a filesystem path. Validate offset as a nonnegative integer and limit as 1..100; reject malformed input rather than silently coercing. Search is a trimmed case-insensitive literal match on ID/display title; scope and filtering precede pagination. Sort updatedAt descending, then ID ascending. Missing titles display ID. Decode one supported schema (3), tolerate unknown additive fields and exclude malformed entries with a count/diagnostic; an invalid top-level envelope is an error. Allowlist serialized fields, excluding ownerEmail, arbitrary packet payloads and command data.

Use typed error codes: invalid_input (400), denied (existing 401/403 authentication/authorization response), not_found (404), not_initialized (409), unsupported (503), timeout (504), output_too_large (502), invalid_response (502), runtime_unavailable (503). Preserve code-level distinctions for UI mapping, without returning subprocess output or local secrets in error text. A server lacking these routes is unsupported, not an empty project. Existing authorization permits selecting server-accessible directories: this change does not introduce a new multi-tenant ACL. Isolation means no data crosses request/cache locations, and an actual denied request stays denied; a legitimate switch to another authorized project must work.

Pagination is over each response snapshot; concurrent external mutations can change later pages. Refresh resets pagination and shows the new generatedAt. No durable cursor/history store is added.

### D3. Extend the production app and its actual client consumer


Add Changes as a V2 route and tab kind using R08, with the project chooser/search/compact rows from R07. Keep Home and session tabs functional. A Changes tab carries selected project/location and scope; choosing a row renders Overview, Documents, Tasks, Evidence and Usage within that surface. Browser back/forward and closing/reopening tabs must preserve valid route selection. Tasks reads the real tasks.md checklist under D6/D7; no task graph or gate panel is inferred from snapshot data.

Use the existing SDK provider's selected server and authentication. Regenerate Client after HttpApi changes. Since R06 consumes a tarball, update the vendored client artifact and its app dependency/lockfile through the existing packaging process to the generated matching client; do not merely typecheck the unconsumed packages/client source or bypass typing with ad hoc fetch calls. Retain V1 session compatibility; feature capability failure must be isolated from ordinary sessions.

Preserve R09 session dimensions and composer behavior. On narrow viewports collapse the Changes project/detail arrangement using the existing responsive patterns; avoid viewport overflow and keep navigation operable at 390px. Use R13 tokens, focus and component variants. Render meaningful Changeloop branding with accessible text; decorative duplicate glyphs are hidden from assistive technology. Keep the shared upstream logo for unrelated callers.

### D4. Explicit refresh state and evidence meaning


Key state by server identity + canonical project/location, and use a request generation token to discard responses from an old selection. Entry, focus, manual refresh and a visible-only 10-second interval request refresh; overlapping requests for the same key are coalesced. Abort/unsubscribe on unmount or selection change where supported; generation checks still prevent late commits. Hidden views stop polling. Test with controlled completion order and an injected clock, not sleeps.

Model initial loading, supported empty, populated, unsupported, not_initialized and disconnected/error distinctly. On a failed refresh retain only the same key's last successful data, label it stale, show generatedAt and an actionable retry. Never carry project A's rows into project B's loading/error state. Malformed-entry diagnostics remain visible even if other rows are usable.

Overview combines projected phase/status/time with source-labeled title/Why from proposal.md and exact investigation references; document read failures leave projected status visible. Evidence labels recordedStatus, current status and freshness independently; a stale recorded pass is not a current pass. Archive continues to mean delivered history when verification is unavailable. Usage missing/null is unavailable; measured zero stays zero. Do not infer success from exit code, absence of blockers or assistant prose.

### D5. Draft handoff and canonical command execution


Use existing newDraft/routing/composer state (R08/R10) to open a draft on the chosen server/project. The new-work action is labeled Investigate and seeds `/investigate`. A saved note also offers Continue investigation and Draft change using the explicit note reference (D7). For an existing active change, use the supported command corresponding to its projected phase only when command discovery confirms it; for archive, unknown phase or unavailable mapping, seed `/changes`. Snapshot has no authoritative next action, so the UI must not advertise a computed next gate as fact. The command text remains editable.

Opening or reviewing a draft sends no command and creates no lifecycle transition. Explicit submit goes through the existing session command API, permission and question handling. Keep the draft after recoverable submission errors and preserve the existing session admission/retry semantics.

R10 proves V2 does not automatically run the compatibility layer's legacy command branch. T004 must connect canonical Foundation command preparation to the V2 execution boundary using a host-supplied extension/port consistent with Core dependency direction, and prove it with an actual V2 command request. Reuse the Foundation host instruction resolver and invocation bounds; do not reimplement instructions in the browser or route V2 orchestration through the legacy prompt loop. Restrict this integration to injected Foundation-owned commands, honoring foundation_workflow opt-out and user overrides. If command preparation is unavailable, report that and preserve the draft; do not silently submit a raw imitation of host instructions. The UI grants no Land authority and adds no lifecycle mutation endpoint or session-association database.

### D6. Separate document reads from the runtime snapshot

Use the same Schema/Core port/Protocol/Server/host composition as D1/D2, but give the project-file reader its own capability and failure state. Listing saved notes must not invoke the runtime or require `.foundation/runtime` to exist. The browser reads only the selected server through typed Client; it cannot address arbitrary host paths. Snapshot and file reads have independent timestamps and cannot claim a cross-file atomic transaction.

| Proposed resource | Input | Output |
|---|---|---|
| GET /experimental/foundation/investigations | Existing Location; literal search, offset, limit | Located index: id, heading-or-filename title, relative sourcePath, modifiedAt, readAt; total/nextOffset and diagnostics. |
| GET /experimental/foundation/investigations/:investigationID | Location; validated note identity | Note text/sections, sourcePath, modifiedAt, readAt, sha256 and exact referenced-by Change links with referring document path. |
| GET /experimental/foundation/changes/:changeID/documents | Location; change identity; offset/limit | Located metadata index for allowed documents only; no bulk bodies. |
| GET /experimental/foundation/changes/:changeID/documents/:documentID | Location; opaque server-issued document identity | One bounded UTF-8 document with text, sourcePath, modifiedAt, readAt and sha256. |

Extend capability with independent `snapshot`, `investigations` and `documents` availability. Existing D2 response fields remain compatible. Missing investigations directory is a supported empty list; denied IO is an error; absent runtime affects snapshot only. A missing document reader on an older server hides/disables those panels with an explanation, preserving sessions and any supported snapshot functionality.

Index 50 items by default/100 maximum. Sort notes by modifiedAt descending then ID ascending; search literal title/ID without regex execution. Document index order is proposal, design, tasks, evidence, grounding, then sorted specs. Metadata scans are limited to 4096 candidates, nesting depth 32 and five seconds per request; return `index_limit_exceeded` (503) if incomplete, never a false complete/empty result. Bound a document to 256 KiB and an aggregate response to 1 MiB, including encoded response size. Open bodies lazily. Optional referenced-by enrichment has an independent 1,024-candidate, 2 MiB body, one-second budget within the request deadline and 128 KiB result bound. Broken unrelated documents or exhausted enrichment return the requested note with explicit partial-scan diagnostics; requested-document errors retain their typed status. Single-document oversized output is a typed 413 `document_too_large`; invalid UTF-8 is 422 `invalid_document`; missing is 404; blocked reference is 400 `invalid_input`; changed-during-read retry exhaustion is 409 `document_changed`. Reuse existing denied/unsupported/error conventions; do not expose host absolute paths or file contents in errors.

Allow only `openspec/investigations/*.md` and an identified active Change's `proposal.md`, `design.md`, `tasks.md`, `evidence.yaml`, `grounding.yaml`, `specs/**/*.md`. Archive lookup must uniquely match the dated archived directory to the exact requested Change ID; no prefix or title matching. A missing/ambiguous archive document directory is explicit and does not invalidate runtime delivery status. Prefer the exact active directory when it exists; exclude archive entries from active lookup.

The server issues identities for allowlisted index entries, revalidates canonical project/root and the resolved regular file on every read, and rejects traversal (including encoded variants), escaping symlinks, special files and out-of-root targets. Validate the opened descriptor and detect replacement/size changes so a check-then-open race cannot bypass containment or bounds. Retry a changed file once; otherwise return document_changed with the previous same-key display marked stale. Never return a partial document as a complete one. No recursive generic file browser, arbitrary absolute-path API, init/repair, packet, sandbox creation or subprocess is needed for these reads.

Treat Markdown, filenames and reference URLs as untrusted. Reuse a repository Markdown primitive after verifying its raw-HTML and URL policy; use a maintained sanitizer if that policy is insufficient. Render fenced code inertly, disallow executable/data/file URLs and raw HTML execution, and do not automatically fetch remote images/resources. Internal document references resolve only to allowlisted contained reader targets; explicit HTTPS links may open on user activation with safe external-link attributes. Unsafe or unavailable links render as text with an explanation. Test the actual rendered component, not merely a separate URL helper. Read-only YAML/JSON documents display escaped text, not executable configuration.

Actors are existing server-authorized users; assets are repository document contents, browser session credentials and host filesystem boundaries. Threats are location mix-up, traversal/symlink races, unexpected huge indexes/files, Markdown XSS and remote resource exfiltration. T006 owns real HTTP/file tests and T007 owns rendered-content tests. Required review must inspect these boundaries; automated tests do not replace the change's review provider.

### D7. Source-backed information architecture and handoff

Keep the existing Home grid, project context and V2 tabs. The Changes surface has Investigations / Active / Archived categories. Initial category is Investigations when entering without a saved selection; returning restores category/search/selected item through actual route state. Category counts derive from each corresponding source; do not fold notes into runtime phase counters or assert prototype sample counts as production expectations.

An investigation detail shows its heading, relative path, filesystem modification time and note sections using their actual labels, with heading/filename fallback and full-text access. Filesystem time is not startedAt/completedAt. Label it Saved note; an unsaved investigation remains accessible through ordinary Sessions and is not fabricated as a note. Historical prose remains as written. Only exact contained Markdown/document references establish note ↔ Change navigation, with the referring document visible; no inferred conversion/completion or transcript association. No reference found means absence of an explicit link, not absence of related work. Keep the Investigate entry visually separate from runtime Change/Build/Prove/Land status; do not mark earlier phases checked merely because a later phase is current.

| UI field / panel | Authoritative source | Fallback or limitation |
|---|---|---|
| Investigations, section contents | openspec/investigations/*.md | Filename if no heading; absent directory is empty; no running/completed inference. |
| Change title, Why | proposal.md | ID and unavailable purpose if absent/unreadable; exact text, no generated summary. |
| Runtime phase/status/revision/blockers | snapshot.changes[] and blockers[] | Preserve codes and source timestamp; document failures do not replace status. |
| Documents | proposal/design/tasks/evidence/grounding and specs in resolved active/archive directory | Bounded lazy read; explicit missing/denied/too-large/invalid state per document. |
| Tasks | tasks.md checkbox ledger | Show checked/total with source; not a graph, gate, proof or completion inferred from prose. |
| Planned test cases | design.md test section and spec scenarios | Reader/jump link only when present; missing section is unavailable, not zero tests. |
| Declared evidence claims | evidence.yaml | Obligations separate from recorded provider results; malformed contract is not a successful empty claim list. |
| Recorded/current evidence and freshness | snapshot.evidence[id] | Separate recordedStatus/status/freshness/providers; no current proof inferred. |
| Usage, targets, branch, operation time | snapshot.budgets[id], runs[] | Null remains unavailable; measured zero is zero; operationMs is not elapsed duration. |
| Data freshness and provenance | snapshot.generatedAt; document readAt/modifiedAt/sha256 | Distinct read moments; digest is content identity, not a proof receipt. |
| Note ↔ Change link | Exact contained reference in an indexed agreement document | Link names referring source; no fuzzy or title-based association. |

Documents and Tasks join Overview/Evidence/Usage as real tab panels. Show source metadata unobtrusively beside the content and a keyboard-operable Data sources dialog for the mapping. Parse canonical task checkboxes without changing the task ledger; display scope/claim/verification details on demand. An unrecognized task format still has the original document reader; do not silently manufacture an empty completed checklist. Evidence.yaml parsing must use the format declared by the file (valid YAML or JSON), and render diagnostics for invalid content. Do not assume all repository evidence contracts are JSON because the current example is.

Reuse D4's server/location/generation keys for notes, lists and selected documents. Refresh index metadata on entry/focus/manual/visible interval, fetch only an open document when its metadata changes, and cancel/discard late old-location responses. Preserve same-key last-success content with a stale label; never show a previous project's note after switching. The document viewer remains scrollable on mobile with its navigation accessible; horizontal scroll is contained to wide tables, not the viewport. Tab keys/arrows, section navigation, dialog focus/escape and link names are part of browser evidence.

Continue investigation seeds `/investigate` with the selected note reference; Draft change seeds `/change` with the same explicit reference; New investigate seeds `/investigate`. These actions only open an editable draft on the selected server/project. Existing command discovery, override/opt-out, V2 host preparation, permissions/questions and submit retries remain D5-owned. Following an already-linked Change reads it instead of silently creating a duplicate. No note-to-Change transition executes from a navigation click.

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** Pinned snapshot through an injected host port.
  - **Why:** R02–R05: runtime packaging is host-owned and history reads must work without sandboxes.
  - **Rejected:** Direct packet calls or Server imports from opencode.
  - **Consequences:** Maintain pinned dependency closure and bounded child lifetime.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** Additive Location-scoped typed read API.
  - **Why:** R05/R06: reuse existing authentication, placement and generated contracts.
  - **Rejected:** Browser filesystem reads or generic shell-command endpoints.
  - **Consequences:** Typed error/version handling and consumer regeneration are required.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** Extend production V2 navigation and actual client artifact.
  - **Why:** R06–R10/R13: selected prototype follows existing components; app imports a vendored client.
  - **Rejected:** Shipping the prototype HTML or an independent dashboard theme.
  - **Consequences:** Route/tab integration and packaged client alignment must be verified.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-004
  - **Status:** accepted
  - **Decision:** Keyed visible-only refresh and separate evidence labels.
  - **Why:** Projection freshness and late responses can otherwise misrepresent the selected project.
  - **Rejected:** Unkeyed shared cache or treating recorded pass as current proof.
  - **Consequences:** Maintain explicit stale/error states and deterministic scheduling tests.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-005
  - **Status:** accepted
  - **Decision:** Editable draft handoff through canonical session command preparation.
  - **Why:** R10/R11: V2 does not inherit legacy hook execution; navigation conveys no execution authority.
  - **Rejected:** Direct lifecycle buttons or browser-authored host instructions.
  - **Consequences:** Prove V2 admission, opt-out, overrides and retained drafts.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-006
  - **Status:** accepted
  - **Decision:** Add a separately available, bounded Location-scoped document reader using opaque allowlisted identities.
  - **Why:** Snapshot schema 3 omits saved investigations and agreement contents; research can exist before runtime initialization.
  - **Rejected:** Expanding snapshot guesses, a generic filesystem endpoint, or requiring packet/sandbox materialization for reading documents.
  - **Consequences:** Independent capability/errors/timestamps, containment and Markdown security tests, and typed consumer updates are required.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-007
  - **Status:** accepted
  - **Decision:** Show saved Investigations separately and add source-backed Documents/Tasks plus explicit-reference draft handoff.
  - **Why:** The user selected the revised prototype; note existence and checked tasks are different from runtime phase and proof.
  - **Rejected:** Treating every note as an active Change or inferring conversion/session association from titles and chat text.
  - **Consequences:** Preserve source provenance and honest missing states; production replaces the prototype renderer and captured data.
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

No persisted-state migration is intended. Projection reads must leave project files unchanged. New read endpoints are additive; generated consumer artifacts must be version-aligned and validated using the client actually imported by app. Existing servers without capability support still support ordinary sessions. Snapshot-only servers may render status/evidence/usage while the document panels explain unsupported capability. Document-reader support remains usable when the runtime is missing or uninitialized. No note schema/frontmatter migration is required; inconsistent historical headings are preserved. Preserve V1 and V2 session behavior, opt-out and user overrides.

Deliver source and a locally verified binary with matching embedded UI/API/runtime. Document existing supported local build/run commands and the upstream fallback limitation from R01. Do not claim that starting a source server with fallback delivers local custom assets. Public release/deployment is outside this change.

Rollback is removal/reversion of the additive feature, host port binding, client artifact update and session-specific logo changes, rebuilding the matching binary/assets. Since reads create no durable project state, no data rollback or sandbox recreation is needed. Confirm existing Home/session paths after rollback. Do not replace existing user command definitions during either rollout or rollback.

## Planned test cases and requirement traceability

Each row is an assertion to implement under the owning task, with setup/input and an observable expected result. Case IDs below are local test names, not new evidence claims. Existing claim IDs are preserved. All cases are **planned**, with no product test execution claimed at Change time.

| Case | Claim | Owner / level | Setup and action | Expected result |
|---|---|---|---|---|
| P01 | bundled-projection | T001 / runtime integration | Invoke bundled snapshot in an initialized temporary project without Foundation on PATH. | Schema 3 decodes; no external installation/download needed. |
| P02 | bundled-projection | T001 / artifact integration | Materialize generated payload and traverse actual dashboard entry point. | Full dependency closure resolves; manifest checksums match pinned source. |
| P03 | bundled-projection | T001 / runtime integration | Choose explicit path runtime that is missing/incompatible; separately damage bundled payload. | Selected-mode error; no silent switch to the other runtime. |
| P04 | bundled-projection | T001 / filesystem integration | Record project tree/content before supported and uninitialized reads. | No init/repair, new sandbox, or project file changes. |
| A01 | scoped-read-api | T002 / real HTTP | Call capability/list/detail without required credentials, then with valid credentials. | Existing denied response for unauthorized calls; authorized calls use normal Location envelope. |
| A02 | scoped-read-api | T002 / real HTTP | Two canonical locations contain same change ID but different data; issue interleaved reads and legitimate project switch. | Each response belongs to its resolved project; no shared-cache leakage. |
| A03 | scoped-read-api | T002 / real HTTP | IDs containing traversal/separators/encoded traversal; malformed offset/limit (negative, fractional, 0, 101). | Invalid input before subprocess/path use; valid IDs and bounds 1/100 accepted. |
| A04 | scoped-read-api | T002 / subprocess integration | Snapshot child hangs beyond 5s or emits more than 1 MiB. | Child terminated, typed timeout/oversize result, no retained in-flight entry. |
| A05 | scoped-read-api | T002 / decoder integration | Schema 3 with extra fields, unsupported schema, invalid JSON and invalid top-level shape. | Extra fields accepted; unsupported and invalid-response distinguished; failures never empty success. |
| A06 | scoped-read-api | T002 / HTTP serialization | Projection contains ownerEmail and raw packet/command fields. | Public response allowlist omits these fields; errors do not echo raw output. |
| A07 | scoped-read-api | T002 / runtime integration | Two concurrent same-project reads, one different project; fail first read then retry. | Same key shares one child, other key independent, retry starts fresh after failure. |
| A08 | scoped-read-api | T002 / contract integration | Missing init, unavailable runtime, missing change, denied location, valid empty project. | Distinct error/result codes from D2 with no unauthorized data or misleading empty result. |
| L01 | bounded-change-list | T002 / projection test | Mixed active/archive, equal updatedAt, missing titles, >100 entries; search and page. | Correct scope; deterministic tie order; ID fallback; default50/max100 and filtered counts/nextOffset correct. |
| L02 | bounded-change-list | T002 / decoder test | Mix valid and malformed entries; missing/null usage and measured zero. | Valid entries retained, malformed count present; unavailable differs from measured zero. |
| E01 | truthful-evidence | T002 / projection test | recordedStatus=pass with stale/unverified current evidence. | Independent values survive projection, with no synthesized current pass. |
| E02 | truthful-evidence | T002 / filesystem integration | Archive a fixture and remove its sandbox, then list/get. | Archive remains delivered history; no packet invocation or workspace recreation. |
| U01 | existing-ui-design | T003 / browser | Open Home → Changes → details; switch Home/session tabs and browser history. | Production routes/tabs work, correct selected project and details, existing navigation retained. |
| U02 | existing-ui-design | T003 / browser | Render Changes at desktop and 390px in both themes, keyboard-only. | No viewport overflow; named controls, visible focus, non-color status text; appropriate responsive navigation. |
| U03 | refresh-and-failure-states | T003 / controller | Delay project A response; switch project/server B and complete B then A. | Only B displayed; A completion cannot overwrite state or B errors. |
| U04 | refresh-and-failure-states | T003 / controller | Advance injected time; hide/show, focus, manually refresh, then unmount. | Visible interval is 10s, triggers refresh as specified, no hidden/unmounted polling or duplicate in-flight work. |
| U05 | refresh-and-failure-states | T003 / component | Exercise initial loading, empty, init missing, unsupported route/schema, disconnected, malformed subset. | Distinct visible states with usable retry, no false zero/empty success. |
| U06 | refresh-and-failure-states | T003 / component | Successful read then failed refresh; switch project while stale. | Same-key data retained with stale label/generatedAt; old-key data removed on switch. |
| U07 | truthful-evidence,bounded-change-list | T003 / component | Display stale pass, unverified archive, absent usage and zero usage. | Correct separate evidence labels, delivery history and unavailable/zero text; no fabricated tasks/gates/next action. |
| S01 | session-draft-handoff | T004 / browser + request capture | Choose New change and active/history row handoff. | Draft contains /investigate, discovered phase command or /changes; server/project correct; zero command requests before submit. |
| S02 | session-draft-handoff | T004 / real V2 HTTP | Explicitly submit injected Foundation command through actual V2 session API. | Canonical host instruction resolver executes once and its resolved content reaches durable admission; no legacy prompt loop bypass. |
| S03 | session-draft-handoff | T004 / integration | Disable foundation_workflow; separately configure same-name user command override. | No injected Foundation dispatch under opt-out; override executes unchanged. |
| S04 | session-draft-handoff | T004 / browser + integration | Fail command preparation/submission; retry using existing flow; exercise permission/question interaction. | Draft retained; normal permission/question handling; no duplicate admission on exact retry or inferred Land authority. |
| S05 | session-draft-handoff | T004 / compatibility integration | Repeat handoff with V1 server and test old server lacking Changes API. | Existing supported session command path works; unavailable Changes does not break ordinary sessions. |
| B01 | changeloop-session-brand | T004 / browser | Open V2 and legacy new/empty session in light/dark at desktop/390px. | Changeloop pixel/arrow identity and accessible name; correct compact legacy mark, intact composer geometry. |
| B02 | existing-ui-design,changeloop-session-brand | T004 / source + browser | Inspect shared logo consumers and session after submission. | Only intended session call sites change; normal transcript/composer and unrelated branding remain intact. |
| D01 | embedded-ui-delivery,bundled-projection | T005 / compiled binary + browser | Build embedded app and start binary without standalone Foundation on PATH. | Served assets include real Changes route/logo; authenticated API reads fixture snapshot. |
| D02 | embedded-ui-delivery | T005 / delivery integration | Exercise serve and web UI delivery; inspect documented fallback case. | Both serve matching embedded assets; serve does not auto-open browser; fallback limitation and local instructions are accurate. |
| D03 | scoped-read-api,existing-ui-design | T005 / consumer integration | Regenerate clients, package actual app consumer, typecheck affected packages and build app. | No generated drift or mismatched vendored API; shipped app imports and invokes the typed methods. |
| D04 | the original nine claims | T005 / integrated acceptance | Run read → stale/history detail → draft → explicit V2 submit with fixture project, matching binary/UI. | Boundary behavior agrees with cases above; browser traces and test results are retained and tied to the current content. |
| I01 | investigation-library | T006 / real files + HTTP | Five differently structured notes; missing headings, renamed sections and an unsaved session. | Index contains saved notes only, heading/filename fallback, literal sections and file modified times; no inferred running/completed state. |
| I02 | investigation-library,safe-document-reader | T006 / real HTTP | No runtime installation/init, then absent investigations directory, denied directory and unsupported reader. | Notes read independently of snapshot; supported absent directory is empty, denied/unsupported distinct; project tree unchanged. |
| I03 | investigation-library | T006 / index test | Exact contained note reference, same title without link, broken link and escaped target in active/archive docs. | Only exact valid reference creates a navigable association with source; no completion or conversion claim. |
| I04 | investigation-library,safe-document-reader | T006 / bounded index | >100 notes, equal mtimes, literal search; exceed 4096 candidates/depth32/5s scan. | Stable order and 50/100 pagination; incomplete scans fail explicitly and release resources rather than return false totals. |
| F01 | safe-document-reader | T006 / real HTTP | Valid credentials for two locations sharing IDs; missing credentials; encoded traversal and path separators. | Existing authorization and per-request canonical scope; no cross-location document leakage or generic path access. |
| F02 | safe-document-reader | T006 / real files | Escaping symlink, non-regular file and replacement between validation/open. | Refused safely; opened descriptor cannot escape allowed root or bypass size checks. |
| F03 | safe-document-reader | T006 / real files | Exact256KiB and >256KiB document, >1MiB encoded response, invalid UTF-8, file changed twice during read. | Boundaries enforced; typed too-large/invalid/document-changed states, no unmarked partial content. |
| F04 | safe-document-reader,document-task-provenance | T006 / archive fixture | Exact active directory, uniquely dated archive, missing/ambiguous archive; no old sandbox. | Resolve only the correct allowlist or explicit error; retain runtime delivery history without packet/repair. |
| F05 | safe-document-reader | T007 / rendered browser | Markdown includes script/raw HTML, javascript/data/file URLs, remote image and fenced markup. | No execution/automatic network request; code inert, unsafe links text; contained internal and activated HTTPS links behave as declared. |
| F06 | document-task-provenance | T006/T007 / parser + component | JSON and YAML evidence, malformed contract, canonical/noncanonical task checklist, missing planned-test section. | Exact obligation/task content or explicit parse fallback; original document stays available; checked tasks never imply proof. |
| F07 | document-task-provenance | T007 / component | Missing proposal, stale same-key doc, runtime success with file error, unknown/zero usage. | ID fallback, preserved runtime status, source timestamps/stale labels, unavailable distinct from zero. |
| V01 | investigation-draft-navigation,investigation-library | T007 / browser | Home → Investigations → note section → exact Change link; back/forward and category/search restore. | Correct route and project selection, original section labels and explicit source link; no workflow transition. |
| V02 | investigation-draft-navigation | T007 / browser + request capture | New investigate, Continue investigation and Draft change; opt-out/override and recoverable submit failure. | Editable correct command/reference on chosen server/project, zero execution before submit, normal discovery/override behavior and retained draft. |
| V03 | investigation-draft-navigation,safe-document-reader | T007 / browser | Keyboard/tab arrows, dialog open/escape, section links and wide design table at desktop/390px in both themes. | Accessible names/focus, contained table scroll, intact V2 navigation/composer/logo; no viewport overflow. |
| V04 | document-task-provenance,safe-document-reader | T007 / controlled requests | Delay note/document A, switch server/project B, complete A late; hidden view and metadata refresh. | No old-location data commit; independent capabilities/errors and visible-only bounded refresh; only selected changed body fetched. |
| V05 | investigation-library,safe-document-reader,document-task-provenance,investigation-draft-navigation | T008 / embedded binary + browser | Matching compiled app/API with real notes/active+archived docs; runtime absent and then available; read tasks/tests/proof → draft. | All source mapping and failure partitions remain truthful; note/document APIs actually work in served assets, no navigation mutation. |

### Test implementation locations and execution contract

Planned files (not present yet): `packages/opencode/test/plugin/foundation-webui.test.ts` owns P cases; `packages/opencode/test/server/foundation-webui.test.ts` owns A/L/E cases; focused app `*.test.ts` files own U controller/component cases; `packages/app/e2e/foundation-webui.spec.ts` owns U/S/B browser cases; a host integration test owns S02/S03 and real command preparation. `packages/opencode/script/verify-foundation-webui.ts` is the final executable entrypoint for S dispatch, browser, consumer and compiled-binary checks. It must fail if a required suite/fixture/artifact is missing or skipped. Test fixture names and commands must be reconciled with these locations when authored, without silently weakening a claim.

T006 adds `packages/opencode/test/server/foundation-documents.test.ts` for I01–I04/F01–F04 and parser coverage. T007 adds focused reader/controller tests under app/src and `packages/app/e2e/foundation-documents.spec.ts` for F05–F07/V01–V04. T008 adds `packages/opencode/script/verify-foundation-documents.ts` to execute the new browser/HTTP/embedded-consumer checks with fail-on-missing/skip behavior. These are planned files, not existing or passing tests. T005 retains its original nine-claim suite; T008 adds the four new claims without replacing the old evidence.

Use real temporary project files and HTTP services following R14. For time/order tests use controllable clock/process boundaries and deferred completions; do not use wall-clock sleeps to manufacture ordering. Browser route fixtures are suitable for display-state tests; they do not replace real API/host/compiled-binary evidence. No provider network call is needed to prove canonical command preparation/admission: inspect actual admitted content before model execution using supported admit-only/test boundaries.

The amended evidence provider runs the P suite, A/L/E suite, app unit suite, `script/verify-foundation-webui.ts`, `test/server/foundation-documents.test.ts`, and `script/verify-foundation-documents.ts`. The final runner must execute the missing boundary suites and return nonzero on any failure. `minimum: 6` is the required browser-report discovery floor, not proof that all 13 claims are covered. Completion requires the matrix assertions and corresponding executable tests, not one passing unrelated test. Broad app unit success alone cannot satisfy browser, host dispatch or binary delivery claims.

Focused commands already bound in [tasks](tasks.md) and [evidence](evidence.yaml): run Bun from package directories. T005 additionally runs `bun typecheck` in every changed package with that script, `bun run generate` in packages/client (and the legacy SDK build when its public contract changes), a generated-output drift check, the actual app build and focused Playwright suite using R14 configuration. The runner owns setup/teardown of its matching backend and fixture project; Playwright's existing webServer starts frontend only. Do not record proof until these commands exist and execute successfully against implemented code. Required review remains separate from automated test exit status.

## Risks

| Risk | Resolution / evidence | Owner |
|---|---|---|
| Dashboard dependency missing in compiled bundle | Tagged-source closure/checksums plus no-PATH binary exercise P01–P03, D01. | T001/T005 |
| Location leakage or shell/path injection | Existing auth, canonical scoped keys, fixed argv, output allowlist; A01–A08. No invented tenant authorization promise. | T002 |
| Process leak or stale UI overwrite | Bounded child lifetime, cleanup after failure, generation guards and visible-only scheduling; A04/A07/U03/U04. | T001/T003 |
| Evidence overstatement after archive | Projection-only history, separate status/freshness, unavailable usage; E01/E02/U07. | T002/T003 |
| V2 draft submits without canonical host instructions | Real V2 admission assertion S02, opt-out/override S03; visual demo is insufficient. | T004 |
| Generated client never reaches app | Update and check actual vendored consumer; D03. | T002/T005 |
| Prototype fidelity mistaken for production parity | Use production components, exercise actual responsive/theme/keyboard UI; U01/U02/B01. | T003/T004 |
| Filesystem or Markdown reader escapes its boundary | Real file/HTTP containment, race/limit tests F01–F04 and rendered payload/network assertions F05. | T006/T007 |
| Notes/tasks are presented as lifecycle proof | Explicit references, source labels and independent timestamps; I01–I03/F06/F07/V01–V05. | T006/T007/T008 |
| UI passes tests but binary serves upstream UI | Matching embedded app/API/artifact proof D01/D02; documented local build. | T005 |

## Review and completion boundary

This Change contains design and planned tests only. Eight implementation tasks remain unchecked. Structural validation means the contract parses and links; it does not mean product tests passed, the browser UI shipped, or external review approved it. Build must provide the tests above and Prove must bind actual results to the current content before any delivery claim.
