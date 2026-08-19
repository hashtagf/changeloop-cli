## ADDED Requirements

### Requirement: Bundled Foundation lifecycle execution uses the selected runtime

When Changeloop owns at least one Foundation built-in command, the system SHALL
make lifecycle operations named by canonical Foundation instructions resolve
through the same selected bundled or explicit PATH runtime used for host
instruction and agent-contract resolution. In bundled mode it SHALL expose a
release-bound `claude-foundation` executable only through the Location-scoped
shell and PTY environment, without mutating the process-global or user's PATH,
and SHALL fail closed rather than fall back to a different executable.

#### Scenario: Bundled lifecycle commands use the selected runtime

- **WHEN** bundled mode is active, the project harness is initialized, and no
  external `claude-foundation` executable exists on the incoming PATH
- **THEN** a canonical instruction that invokes `claude-foundation` resolves to
  the checksum-pinned bundled release
- **AND** the lifecycle operation executes against the current project harness
- **AND** agent shells, background command processes, and PTYs receive the same
  release-bound execution-shim directory
  through the existing `shell.env` contract
- **AND** no process-global environment mutation is required

#### Scenario: PATH and inactive modes preserve the existing execution environment

- **WHEN** configuration selects `foundation_runtime: "path"`, disables
  `foundation_workflow`, or makes every Foundation command name user-owned
- **THEN** Changeloop does not inject the bundled execution shim into PATH
- **AND** explicit PATH mode resolves instruction, context, and lifecycle
  execution through the caller's external executable
- **AND** inactive built-ins leave existing shell and PTY PATH values unchanged

#### Scenario: Invalid bundled shim fails closed

- **WHEN** the bundled manifest, materialized payload, or execution shim is
  missing, altered, unsafe, or cannot be validated
- **THEN** Changeloop reports a stable bundled-runtime failure and stops
- **AND** it does not execute an external PATH Foundation as an implicit fallback

#### Scenario: Compiled binary executes lifecycle without PATH Foundation

- **WHEN** a compiled Changeloop binary runs in a fresh temporary project with
  external `claude-foundation` removed from PATH
- **THEN** an authorized initialization and a real read-only Foundation
  lifecycle command execute from the embedded declared release
- **AND** the evidence observes the lifecycle result rather than only host
  instruction or doctor success

### Requirement: Bundled initialization installs the OpenCode host integration

Changeloop SHALL initialize and upgrade bundled Foundation projects through the
pinned release's `--host opencode` installer contract. The embedded payload
SHALL contain the declared OpenCode installer, and successful initialization
SHALL install its canonical native command, guard-plugin, and ownership-manifest
surfaces without overwriting artifacts that Foundation does not own.

#### Scenario: OpenCode host integration is installed

- **WHEN** a user authorizes `changeloop foundation init` or `upgrade` in
  bundled mode
- **THEN** Changeloop invokes the pinned release through `init --host opencode`
- **AND** the project receives canonical `.opencode/commands`,
  `.opencode/plugins/foundation.js`, and
  `.foundation/adapter-manifests/opencode.txt` alongside the shared harness

#### Scenario: Foundation-managed OpenCode commands use bundled runtime

- **WHEN** native `.opencode/commands` recorded by the Foundation adapter
  manifest take precedence over Changeloop's dispatcher markers
- **THEN** Changeloop recognizes those commands as Foundation-managed ownership
- **AND** their shell and PTY lifecycle execution still resolves the selected
  bundled release

#### Scenario: User-owned OpenCode artifacts are preserved

- **WHEN** `.opencode` contains a colliding command or plugin path that the
  Foundation adapter manifest does not own
- **THEN** initialization and upgrade preserve that artifact
- **AND** Changeloop does not treat the unowned collision as authority to shadow
  the caller's execution environment

#### Scenario: Bundled payload includes OpenCode installer

- **WHEN** the vendored Foundation release is synchronized or verified for a
  Changeloop build
- **THEN** `install-opencode.sh` is present, executable, checksum-declared, and
  embedded with the same tagged release as `cli.sh`
- **AND** a missing or altered host installer fails before publishing the binary
