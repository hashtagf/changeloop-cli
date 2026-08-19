# foundation-workflow Specification

## Purpose
TBD - created by archiving change foundation-workflow-commands-builtin. Update Purpose after archive.
## Requirements
### Requirement: Foundation loop commands are built into the CLI

The system SHALL inject the eight claude-foundation change-loop commands
(`investigate`, `change`, `build`, `prove`, `land`, `changes`, `feature`,
`dev`) into the command surface at boot. When an injected command executes, the
system SHALL synchronously resolve its canonical instruction through the
versioned host-instruction API of the checksum-pinned Foundation release bundled
with Changeloop by default, without reading project-owned command files or
downloading a workflow body at runtime. An explicit PATH compatibility mode MAY
select a compatible external `claude-foundation` executable.

#### Scenario: Loop commands present by default

- **WHEN** the CLI boots with a config that does not set `foundation_workflow`
- **THEN** all eight loop commands are listed with built-in dispatcher markers

#### Scenario: Canonical project instruction is used

- **WHEN** an injected loop command is invoked and the bundled Foundation
  release supports the negotiated host-instruction protocol
- **THEN** Changeloop replaces its dispatcher marker with the matching
  instruction returned by that bundled release
- **AND** forwards the invocation arguments as one opaque argv value
- **AND** does not require a `claude-foundation` executable on PATH

#### Scenario: Explicit PATH compatibility mode

- **WHEN** configuration selects PATH runtime mode
- **THEN** Changeloop resolves commands and agent context from the same
  compatible PATH-selected executable
- **AND** reports a stable failure when that executable is unavailable or
  protocol-incompatible

#### Scenario: Partial Foundation installation fails closed

- **WHEN** the selected runtime is missing, times out, lacks the host API,
  rejects the protocol, or returns an invalid response
- **THEN** Changeloop reports a stable actionable diagnosis and stops
- **AND** does not read a project command file, download a replacement, use a
  different runtime source implicitly, or improvise the workflow

#### Scenario: Additive protocol response remains compatible

- **WHEN** a protocol-1 response contains valid required fields plus unknown
  additive fields
- **THEN** Changeloop accepts the response and ignores the unknown fields

#### Scenario: Opt-out disables injection

- **WHEN** the CLI boots with `foundation_workflow: false`
- **THEN** none of the eight loop commands are injected or intercepted and the
  existing built-in commands (`init`, `review`) and user-defined commands are
  unchanged

### Requirement: User-defined commands take precedence over injected ones

The system SHALL NOT overwrite a user-defined command whose name collides with
a foundation loop command.

#### Scenario: Collision keeps the user's template

- **WHEN** the user config defines `command.change` and the CLI boots with
  injection enabled
- **THEN** the user's `change` command template is served unchanged and the
  remaining loop commands are still injected

### Requirement: The opt-out config field is compatible across config versions

The system SHALL accept `foundation_workflow` as an optional boolean in the v1
config schema without breaking existing config documents.

#### Scenario: v1 decode and migration survive the new field

- **WHEN** a config document containing `foundation_workflow` is decoded by
  the v1 schema and passed through the v1→v2 migration path
- **THEN** decoding succeeds with the field intact and migration completes
  without error

### Requirement: Foundation built-ins provide canonical agent context

The system SHALL resolve the package-owned Foundation agent contract through
host agent-contract protocol 1 from the same selected bundled or explicit PATH
runtime used for command instructions, and append it to the model system prompt
when Changeloop owns at least one Foundation built-in command.

#### Scenario: Canonical context is injected

- **WHEN** Foundation built-ins are active and the selected endpoint returns a
  valid protocol-1 response
- **THEN** the exact returned contract is appended to the system prompt
- **AND** one resolution is reused for later turns in the same plugin instance

#### Scenario: Context endpoint fails closed

- **WHEN** the endpoint is missing, times out, exceeds the output bound, or
  returns a malformed or mismatched response
- **THEN** the system prompt contains stable bundled-runtime or explicit PATH
  recovery guidance
- **AND** Changeloop does not use a bundled summary, project file fallback, or
  implicitly switch runtime sources

#### Scenario: Inactive built-ins add no context

- **WHEN** `foundation_workflow` is false or every Foundation command name is
  user-owned
- **THEN** Changeloop does not invoke the endpoint or append Foundation context

### Requirement: Changeloop bootstraps the bundled Foundation harness explicitly

The system SHALL provide `changeloop foundation init`, `status`, `doctor`, and
`upgrade` operations backed by the pinned Foundation release so a supported,
writable project can install and operate the complete harness without a
separately installed Foundation executable.

#### Scenario: Fresh project is initialized

- **WHEN** a user explicitly authorizes Foundation initialization in a writable
  project on a supported platform
- **THEN** Changeloop verifies the bundled release and invokes its canonical
  installer for that project
- **AND** reports the installed version and doctor outcome

#### Scenario: Opening a project remains read-only

- **WHEN** Changeloop opens a project that has no Foundation installation
- **THEN** it does not create or modify project files merely because the project
  was opened

#### Scenario: First Foundation command guides one-time bootstrap

- **WHEN** a Changeloop-owned Foundation command is invoked in an uninitialized
  project
- **THEN** the workflow requests explicit initialization authority once and
  provides the bounded bundled initialization route
- **AND** can continue the requested command after successful initialization

#### Scenario: Repeated initialization converges

- **WHEN** initialization or upgrade is rerun with the same pinned release
- **THEN** managed files converge to the release manifest
- **AND** unchanged project-owned files and unrelated repository content remain
  byte-for-byte unchanged

#### Scenario: Unsafe target is rejected before mutation

- **WHEN** the target escapes the canonical project root, a managed destination
  resolves through an unsafe symlink, the payload checksum is invalid, or the
  platform is unsupported
- **THEN** Changeloop exits non-zero before writing any target file
- **AND** reports a stable recovery action without exposing file contents

#### Scenario: Interrupted installation rolls back or resumes safely

- **WHEN** the release-owned installer fails after beginning a mutation
- **THEN** its backup and manifest contract restores the prior target state or
  leaves a deterministic resumable state
- **AND** a later authorized retry converges without deleting unrelated content

### Requirement: Bundled Foundation release identity is reproducible

The system SHALL bind every shipped Changeloop binary to one declared tagged
Foundation source revision, complete payload manifest, and checksums, and SHALL
reject a build whose vendored payload or required host protocols do not match
that declaration.

#### Scenario: Compiled binary works without PATH Foundation

- **WHEN** a released Changeloop binary runs with no `claude-foundation`
  executable on PATH
- **THEN** bundled `status`, host instruction, host agent-contract, and
  authorized initialization operate from the declared embedded release

#### Scenario: Payload drift blocks the build

- **WHEN** a declared payload file is missing, altered, added without a manifest
  update, or lacks a required host protocol
- **THEN** the build fails before publishing a Changeloop artifact

#### Scenario: Runtime use performs no network download

- **WHEN** Changeloop resolves Foundation context or initializes a project in
  bundled mode
- **THEN** it uses only the embedded verified release payload
- **AND** does not fetch executable code or workflow content from the network

