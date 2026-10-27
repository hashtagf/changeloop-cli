# Design

## Current state

- `FoundationWorkflowPlugin` injects eight commands and synchronously spawns
  `claude-foundation` from PATH with a five-second timeout and 256 KiB output
  limit for host instructions and the agent contract.
- The binary build already embeds generated files through Bun's `files` map,
  but no Foundation release payload or installer is included.
- The public Foundation specification currently promises PATH-selected command
  and context resolution. The source Foundation repository already contains
  host agent-contract protocol 1 at commit `3e02fa5`; the installed PATH release
  used by this repository predates that endpoint.
- Foundation owns managed versus project-owned paths, backup, rollback, and
  post-install doctor behavior. Changeloop must invoke that contract rather than
  independently copying selected files.

## Decisions

- **Decision:** Generate a vendored payload and manifest from one tagged
  claude-foundation release, verify its checksum during build, and embed it in
  each compiled binary.
  - **Why:** Builds stay reproducible and runtime use requires no download or
    separately installed Foundation executable.
  - **Rejected:** Pulling latest Foundation at runtime, which is non-reproducible
    and introduces a remote-code supply-chain boundary.
- **Decision:** Foundation remains the sole owner of install semantics;
  Changeloop invokes the bundled release's installer through an argv-only local
  subprocess and reports its structured outcome.
  - **Why:** Managed paths, project-owned seeds, backup, rollback, and doctor
    behavior must not drift between two installers.
  - **Rejected:** Rewriting managed-file copy and merge rules in TypeScript.
- **Decision:** The bundled runtime is the default. Add
  `foundation_runtime: "path"` as an explicit compatibility escape hatch while
  preserving `foundation_workflow` and user-owned command precedence.
  - **Why:** A pinned default makes commands and agent context agree, while the
    opt-in mode gives existing custom installations a migration path.
  - **Rejected:** Prefer PATH when present, which recreates the version drift
    this change is intended to remove.
- **Decision:** Opening Changeloop is read-only. The first Changeloop-owned
  Foundation command in an uninitialized project emits one approval-guided
  bootstrap instruction; `changeloop foundation init --yes` performs the
  mutation and the command can then continue against the bundled runtime.
  - **Why:** Invoking a workflow demonstrates intent, but installing managed
    files remains an explicit repository mutation.
  - **Rejected:** Writing to every opened directory at startup.
- **Decision:** Resolve the target to a canonical project root before writing,
  reject escapes and symlinked managed destinations, use an argument array with
  no shell interpolation, and stop before mutation on checksum, platform, or
  compatibility failure.
  - **Why:** Repository paths and existing files cross a local trust boundary;
    failure must not overwrite content outside the selected project.
  - **Rejected:** Sanitizing raw paths or continuing after partial validation.

## Compatibility and migration

Existing `foundation_workflow` documents remain valid. The default runtime
source changes from PATH to the bundled release; users who intentionally manage
Foundation externally set `foundation_runtime: "path"`. Existing Foundation
projects are inspected before upgrade and are changed only by explicit init or
upgrade authority. The upstream installer owns backups and rollback for target
files. Rolling Changeloop back restores PATH selection but does not remove an
already installed compatible harness. Release requires a tagged Foundation
artifact containing host agent-contract protocol 1 and its published checksum.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A stale or tampered payload is shipped | Pin version and checksum; fail the build on manifest drift | supply-chain |
| Initialization overwrites user content or follows a hostile symlink | Delegate to Foundation ownership rules and add canonical-path, preservation, and rollback cases | security |
| Bundled command and agent-context protocols diverge | Exercise both endpoints from the same compiled binary without Foundation on PATH | compatibility |
| Installation stops after partial writes | Require Foundation's atomic backup/rollback behavior and verify retry convergence | resilience |
| Binary size or packaging omits payload files | Manifest completeness check and compiled-binary smoke test | deployment |
